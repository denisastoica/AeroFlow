"""
Sistem de migrații schema pentru SQLite.

Fiecare migrare este o funcție numerotată care rulează O SINGURĂ DATĂ.
Migrarile aplicate sunt urmărite în tabela `_migrations` din baza de date.

Cum se adaugă o migrare nouă:
    1. Definești o funcție `_mXXXX_descriere(conn)` mai jos.
    2. O adaugi în lista MIGRATIONS cu același nume ca cheia de tracking.
    3. La următorul start al serverului se aplică automat.

Notă: Funcționează cu SQLite (compatibil cu limitările sale de ALTER TABLE).
      Nu necesită Alembic sau alte dependențe externe.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine


def _existing_columns(conn, table: str) -> set:
    if conn.dialect.name == "sqlite":
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
        return {row[1] for row in rows}
    else:

        query = text("SELECT column_name FROM information_schema.columns WHERE table_name = :table")
        rows = conn.execute(query, {"table": table}).fetchall()
        return {row[0] for row in rows}


def _add_column_if_missing(conn, table: str, col_name: str, col_def: str) -> bool:
    """Adaugă coloana dacă nu există. Returnează True dacă a fost adăugată."""
    if col_name not in _existing_columns(conn, table):
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))
        return True
    return False


def _m0001_users_add_profile_fields(conn):
    """Adaugă câmpurile de profil la tabela users."""
    dt_type = "TIMESTAMP" if conn.dialect.name == "postgresql" else "DATETIME"
    for col_name, col_def in [
        ("name",       "VARCHAR"),
        ("phone",      "VARCHAR"),
        ("role",       "VARCHAR DEFAULT 'customer'"),
        ("is_active",  "BOOLEAN DEFAULT 1"),
        ("created_at", dt_type),
        ("updated_at", dt_type),
    ]:
        _add_column_if_missing(conn, "users", col_name, col_def)


def _m0002_drones_add_route_fields(conn):
    """Adaugă câmpuri pentru navigare și destinație la tabela drones."""
    for col_name, col_def in [
        ("route_path",      "TEXT"),
        ("route_index",     "INTEGER DEFAULT 0"),
        ("dest_latitude",   "FLOAT"),
        ("dest_longitude",  "FLOAT"),
        ("stuck_steps",     "INTEGER DEFAULT 0"),
        ("charge_count",    "INTEGER DEFAULT 0"),
    ]:
        _add_column_if_missing(conn, "drones", col_name, col_def)


def _m0003_drones_add_battery_physics(conn):
    """Adaugă câmpuri pentru modelul fizic de baterie la tabela drones."""
    for col_name, col_def in [
        ("max_battery_wh",     "FLOAT DEFAULT 500.0"),
        ("battery_health",     "FLOAT DEFAULT 100.0"),
        ("total_flight_km",    "FLOAT DEFAULT 0.0"),
        ("total_charge_cycles","INTEGER DEFAULT 0"),
        ("motor_efficiency",   "FLOAT DEFAULT 0.92"),
        ("weight_kg",          "FLOAT DEFAULT 3.5"),
    ]:
        _add_column_if_missing(conn, "drones", col_name, col_def)


def _m0004_deliveries_add_fields(conn):
    """Adaugă câmpurile extinse la tabela deliveries."""
    dt_type = "TIMESTAMP" if conn.dialect.name == "postgresql" else "DATETIME"
    for col_name, col_def in [
        ("estimated_distance_km", "FLOAT"),
        ("estimated_duration_h",  "FLOAT"),
        ("customer_id",           "INTEGER NOT NULL DEFAULT 1"),
        ("priority",              "VARCHAR DEFAULT 'normal'"),
        ("package_type",          "VARCHAR DEFAULT 'standard'"),
        ("notes",                 "VARCHAR"),
        ("weight_kg",             "FLOAT DEFAULT 1.0"),
        ("completed_at",          dt_type),
    ]:
        _add_column_if_missing(conn, "deliveries", col_name, col_def)


def _m0005_missions_add_progress_fields(conn):
    """Adaugă câmpuri de progres și metrici la tabela missions."""
    for col_name, col_def in [
        ("status",                  "VARCHAR DEFAULT 'planned'"),
        ("total_distance_km",       "FLOAT"),
        ("progress_pct",            "FLOAT DEFAULT 0"),
        ("remaining_km",            "FLOAT"),
        ("remaining_duration_h",    "FLOAT"),
        ("pickup_waypoint_index",   "INTEGER"),
        ("actual_duration_h",       "FLOAT"),
    ]:
        _add_column_if_missing(conn, "missions", col_name, col_def)


def _m0006_rename_legacy_status_values(conn):
    """Redenumește valorile de status vechi la valorile canonice actuale."""

    conn.execute(text(
        "UPDATE deliveries SET status = 'in_transit' WHERE status = 'in_progress'"
    ))

    conn.execute(text(
        "UPDATE missions SET status = 'planned' WHERE status = 'pending'"
    ))


def _m0007_create_alerts_table(conn):
    """Crează tabela alerts pentru alertele operaționale."""
    id_type = "SERIAL PRIMARY KEY" if conn.dialect.name == "postgresql" else "INTEGER PRIMARY KEY AUTOINCREMENT"
    conn.execute(text(f"""
        CREATE TABLE IF NOT EXISTS alerts (
            id           {id_type},
            alert_type   VARCHAR NOT NULL,
            severity     VARCHAR NOT NULL DEFAULT 'warning',
            drone_id     INTEGER REFERENCES drones(id) ON DELETE SET NULL,
            delivery_id  INTEGER REFERENCES deliveries(id) ON DELETE SET NULL,
            mission_id   INTEGER REFERENCES missions(id) ON DELETE SET NULL,
            message      TEXT NOT NULL,
            details      TEXT,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            acknowledged BOOLEAN NOT NULL DEFAULT 0,
            acknowledged_at TIMESTAMP
        )
    """))

    cols = _existing_columns(conn, "alerts")
    if "severity" in cols and "acknowledged" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_alerts_severity_ack ON alerts (severity, acknowledged)"))
    if "drone_id" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_alerts_drone_id ON alerts (drone_id)"))
    if "delivery_id" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_alerts_delivery_id ON alerts (delivery_id)"))


def _m0008_missions_add_per_leg_fields(conn):
    """Adaugă câmpuri per-segment (pickup vs destination) la tabela missions."""
    for col_name, col_def in [
        ("remaining_km_to_pickup",      "FLOAT"),
        ("remaining_km_to_destination", "FLOAT"),
    ]:
        _add_column_if_missing(conn, "missions", col_name, col_def)


def _m0009_deliveries_add_pod_fields(conn):
    """Adaugă câmpuri Proof of Delivery (PoD) la tabela deliveries."""
    for col_name, col_def in [
        ("confirmation_code",    "VARCHAR(6)"),
        ("confirmed_at",         "DATETIME"),
        ("recipient_name",       "VARCHAR(100)"),
        ("recipient_signature",  "TEXT"),
        ("delivery_photo_url",   "VARCHAR(500)"),
        ("delivery_notes",       "VARCHAR(500)"),
    ]:
        _add_column_if_missing(conn, "deliveries", col_name, col_def)


def _m0010_create_audit_logs_table(conn):
    """Crează tabela audit_logs pentru tracking complet al acțiunilor."""
    id_type = "SERIAL PRIMARY KEY" if conn.dialect.name == "postgresql" else "INTEGER PRIMARY KEY AUTOINCREMENT"
    conn.execute(text(f"""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id           {id_type},
            user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            user_email   VARCHAR(255),
            user_role    VARCHAR(50),
            entity_type  VARCHAR(50) NOT NULL,
            entity_id    INTEGER,
            action       VARCHAR(100) NOT NULL,
            description  TEXT,
            old_value    TEXT,
            new_value    TEXT,
            extra_data   TEXT,
            ip_address   VARCHAR(45),
            user_agent   VARCHAR(500),
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    cols = _existing_columns(conn, "audit_logs")
    if "entity_type" in cols and "entity_id" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id)"))
    if "user_id" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id)"))
    if "action" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action)"))
    if "created_at" in cols:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at)"))


def _m0011_fix_missions_status_constraint(conn):
    """
    Recreează tabela missions cu constrângerea de status corectă (toate valorile posibile).
    Constrângerea veche permitea doar: 'pending', 'in_progress', 'completed', 'failed'.
    Constrângerea nouă permite: 'planned', 'pending', 'en_route_pickup', 'at_pickup',
    'en_route_delivery', 'in_progress', 'charging', 'completed', 'aborted', 'failed'.
    SQLite nu suportă ALTER CONSTRAINT, deci recreăm tabela complet.
    """

    if conn.dialect.name != "sqlite":
        return


    row = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name='missions'")
    ).fetchone()
    if row and "planned" in row[0] and "en_route_pickup" in row[0]:
        return


    conn.execute(text("ALTER TABLE missions RENAME TO missions_old"))


    conn.execute(text("""
        CREATE TABLE missions (
            id                          INTEGER NOT NULL PRIMARY KEY,
            drone_id                    INTEGER NOT NULL REFERENCES drones(id),
            delivery_id                 INTEGER NOT NULL REFERENCES deliveries(id),
            start_time                  DATETIME,
            end_time                    DATETIME,
            estimated_distance_km       FLOAT,
            estimated_duration_h        FLOAT,
            total_distance_km           FLOAT,
            progress_pct                FLOAT DEFAULT 0.0,
            remaining_km                FLOAT,
            remaining_duration_h        FLOAT,
            actual_duration_h           FLOAT,
            status                      VARCHAR DEFAULT 'planned',
            pickup_waypoint_index       INTEGER,
            remaining_km_to_pickup      FLOAT,
            remaining_km_to_destination FLOAT,
            CONSTRAINT ck_missions_progress CHECK (progress_pct >= 0 AND progress_pct <= 100),
            CONSTRAINT ck_missions_status CHECK (status IN (
                'planned', 'pending', 'en_route_pickup', 'at_pickup',
                'en_route_delivery', 'in_progress', 'charging', 'paused',
                'completed', 'aborted', 'failed'
            ))
        )
    """))


    conn.execute(text("""
        INSERT INTO missions
            (id, drone_id, delivery_id, start_time, end_time,
             estimated_distance_km, estimated_duration_h, total_distance_km,
             progress_pct, remaining_km, remaining_duration_h, actual_duration_h,
             status, pickup_waypoint_index, remaining_km_to_pickup, remaining_km_to_destination)
        SELECT
            id, drone_id, delivery_id, start_time, end_time,
            estimated_distance_km, estimated_duration_h, total_distance_km,
            COALESCE(progress_pct, 0.0),
            remaining_km, remaining_duration_h, actual_duration_h,
            CASE status
                WHEN 'pending'      THEN 'planned'
                WHEN 'in_progress'  THEN 'en_route_delivery'
                ELSE COALESCE(status, 'planned')
            END,
            pickup_waypoint_index, remaining_km_to_pickup, remaining_km_to_destination
        FROM missions_old
    """))


    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_missions_drone_status ON missions (drone_id, status)"))


    conn.execute(text("DROP TABLE missions_old"))


def _m0012_deliveries_add_failure_reason(conn):
    """Adaugă câmpul failure_reason la tabela deliveries."""
    _add_column_if_missing(conn, "deliveries", "failure_reason", "VARCHAR")


def _m0013_users_add_last_login(conn):
    """Adaugă câmpul last_login la tabela users."""
    dt_type = "TIMESTAMP" if conn.dialect.name == "postgresql" else "DATETIME"
    _add_column_if_missing(conn, "users", "last_login", dt_type)


def _m0014_alerts_update_status_and_grouping(conn):
    """Actualizează tabela alerts pentru status și grupări."""
    dt_type = "TIMESTAMP" if conn.dialect.name == "postgresql" else "DATETIME"
    _add_column_if_missing(conn, "alerts", "status", "VARCHAR DEFAULT 'new'")
    _add_column_if_missing(conn, "alerts", "occurrence_count", "INTEGER DEFAULT 1")
    _add_column_if_missing(conn, "alerts", "updated_at", dt_type)
    _add_column_if_missing(conn, "alerts", "resolved_at", dt_type)
    

    cols = _existing_columns(conn, "alerts")
    if "acknowledged" in cols:
        conn.execute(text("UPDATE alerts SET status = 'acknowledged' WHERE acknowledged = 1 AND status = 'new'"))
    
    if "updated_at" in cols:
        conn.execute(text("UPDATE alerts SET updated_at = created_at WHERE updated_at IS NULL"))


def _m0015_fix_drones_status_constraint(conn):
    """
    Recreează tabela drones cu constrângerea de status corectă (include maintenance și inactive).
    """

    if conn.dialect.name != "sqlite":
        return

    row = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name='drones'")
    ).fetchone()
    if row and "maintenance" in row[0] and "inactive" in row[0]:
        return


    conn.execute(text("ALTER TABLE drones RENAME TO drones_old"))


    conn.execute(text("""
        CREATE TABLE drones (
            id                  INTEGER NOT NULL PRIMARY KEY,
            name                VARCHAR NOT NULL UNIQUE,
            status              VARCHAR DEFAULT 'idle',
            battery             FLOAT DEFAULT 100.0,
            latitude            FLOAT DEFAULT 0.0,
            longitude           FLOAT DEFAULT 0.0,
            route_path          TEXT,
            route_index         INTEGER DEFAULT 0,
            dest_latitude       FLOAT,
            dest_longitude      FLOAT,
            stuck_steps         INTEGER DEFAULT 0,
            charge_count        INTEGER DEFAULT 0,
            max_battery_wh      FLOAT DEFAULT 500.0,
            battery_health      FLOAT DEFAULT 100.0,
            total_flight_km     FLOAT DEFAULT 0.0,
            total_charge_cycles INTEGER DEFAULT 0,
            motor_efficiency    FLOAT DEFAULT 0.92,
            weight_kg           FLOAT DEFAULT 3.5,
            CONSTRAINT ck_drones_status CHECK (status IN (
                'idle', 'in_mission', 'charging', 'going_to_charging', 'maintenance', 'inactive'
            )),
            CONSTRAINT ck_drones_battery_range CHECK (battery >= 0 AND battery <= 100),
            CONSTRAINT ck_drones_health_range CHECK (battery_health >= 0 AND battery_health <= 100)
        )
    """))


    conn.execute(text("""
        INSERT INTO drones
            (id, name, status, battery, latitude, longitude, route_path, route_index,
             dest_latitude, dest_longitude, stuck_steps, charge_count,
             max_battery_wh, battery_health, total_flight_km, total_charge_cycles,
             motor_efficiency, weight_kg)
        SELECT
            id, name, status, battery, latitude, longitude, route_path, route_index,
            dest_latitude, dest_longitude, stuck_steps, charge_count,
            max_battery_wh, battery_health, total_flight_km, total_charge_cycles,
            motor_efficiency, weight_kg
        FROM drones_old
    """))


    conn.execute(text("DROP TABLE drones_old"))


def _m0016_add_planned_route_path(conn):
    """Adaugă coloana planned_route_path la drones și missions."""
    _add_column_if_missing(conn, "drones", "planned_route_path", "TEXT")
    _add_column_if_missing(conn, "missions", "planned_route_path", "TEXT")


def _m0017_add_start_flight_km(conn):
    """Adaugă coloana start_flight_km la missions."""
    _add_column_if_missing(conn, "missions", "start_flight_km", "FLOAT DEFAULT 0.0")


def _m0018_add_paused_to_missions_status(conn):
    """
    Asigură că statusul 'paused' este inclus în constrângerea ck_missions_status.
    Acest pas e necesar pentru bazele de date care au rulat deja m0011 dar fără 'paused'.
    """
    if conn.dialect.name != "sqlite":
        return

    row = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name='missions'")
    ).fetchone()
    
    if not row or "paused" in row[0]:
        return


    conn.execute(text("ALTER TABLE missions RENAME TO missions_old"))


    conn.execute(text("""
        CREATE TABLE missions (
            id                          INTEGER NOT NULL PRIMARY KEY,
            drone_id                    INTEGER NOT NULL REFERENCES drones(id),
            delivery_id                 INTEGER NOT NULL REFERENCES deliveries(id),
            start_time                  DATETIME,
            end_time                    DATETIME,
            estimated_distance_km       FLOAT,
            estimated_duration_h        FLOAT,
            total_distance_km           FLOAT,
            progress_pct                FLOAT DEFAULT 0.0,
            remaining_km                FLOAT,
            remaining_duration_h        FLOAT,
            actual_duration_h           FLOAT,
            status                      VARCHAR DEFAULT 'planned',
            pickup_waypoint_index       INTEGER,
            remaining_km_to_pickup      FLOAT,
            remaining_km_to_destination FLOAT,
            planned_route_path          TEXT,
            start_flight_km             FLOAT DEFAULT 0.0,
            CONSTRAINT ck_missions_progress CHECK (progress_pct >= 0 AND progress_pct <= 100),
            CONSTRAINT ck_missions_status CHECK (status IN (
                'planned', 'pending', 'en_route_pickup', 'at_pickup',
                'en_route_delivery', 'in_progress', 'charging', 'paused',
                'completed', 'aborted', 'failed'
            ))
        )
    """))


    conn.execute(text("""
        INSERT INTO missions
            (id, drone_id, delivery_id, start_time, end_time,
             estimated_distance_km, estimated_duration_h, total_distance_km,
             progress_pct, remaining_km, remaining_duration_h, actual_duration_h,
             status, pickup_waypoint_index, remaining_km_to_pickup, remaining_km_to_destination,
             planned_route_path, start_flight_km)
        SELECT
            id, drone_id, delivery_id, start_time, end_time,
            estimated_distance_km, estimated_duration_h, total_distance_km,
            COALESCE(progress_pct, 0.0),
            remaining_km, remaining_duration_h, actual_duration_h,
            status, pickup_waypoint_index, remaining_km_to_pickup, remaining_km_to_destination,
            planned_route_path, COALESCE(start_flight_km, 0.0)
        FROM missions_old
    """))


    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_missions_drone_status ON missions (drone_id, status)"))


    conn.execute(text("DROP TABLE missions_old"))


def _m0019_fix_deliveries_weight_constraint(conn):
    """
    Schimbă limita de greutate a coletului la 3kg în loc de 25kg.
    """

    conn.execute(text("UPDATE deliveries SET weight_kg = 3.0 WHERE weight_kg > 3.0"))

    if conn.dialect.name == "postgresql":
        conn.execute(text("ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS ck_deliveries_weight"))
        conn.execute(text("ALTER TABLE deliveries ADD CONSTRAINT ck_deliveries_weight CHECK (weight_kg > 0 AND weight_kg <= 3)"))
    elif conn.dialect.name == "sqlite":


        pass


def _m0020_simplify_delivery_priorities(conn):
    """
    Update old priorities to the new simplified ones:
    low -> normal, high -> urgent
    And update the constraint for PostgreSQL.
    """

    conn.execute(text("UPDATE deliveries SET priority = 'normal' WHERE priority = 'low'"))
    conn.execute(text("UPDATE deliveries SET priority = 'urgent' WHERE priority = 'high'"))


    if conn.dialect.name == "postgresql":
        conn.execute(text("ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS ck_deliveries_priority"))
        conn.execute(text("ALTER TABLE deliveries ADD CONSTRAINT ck_deliveries_priority CHECK (priority IN ('normal', 'urgent', 'emergency'))"))
    elif conn.dialect.name == "sqlite":

        pass


def _m0021_drones_add_maintenance_source(conn):
    """Add maintenance_source to distinguish manual vs simulator maintenance."""
    _add_column_if_missing(conn, "drones", "maintenance_source", "VARCHAR")


def _m0022_deliveries_add_address_fields(conn):
    """Add human-readable address fields to deliveries table."""
    _add_column_if_missing(conn, "deliveries", "pickup_address", "VARCHAR(500)")
    _add_column_if_missing(conn, "deliveries", "dest_address", "VARCHAR(500)")


def _m0023_deliveries_add_dropoff_safety_fields(conn):
    """Adaugă câmpurile de siguranță la drop-off pentru tabela deliveries."""
    for col_name, col_def in [
        ("dropoff_safety_status", "VARCHAR"),
        ("dropoff_safety_reason", "VARCHAR"),
        ("dropoff_weather_safe",  "VARCHAR"),
        ("dropoff_battery_pct",   "FLOAT"),
        ("dropoff_distance_m",    "FLOAT"),
        ("dropoff_code_required", "VARCHAR"),
    ]:
        _add_column_if_missing(conn, "deliveries", col_name, col_def)


MIGRATIONS = [
    ("0001_users_add_profile_fields",           _m0001_users_add_profile_fields),
    ("0002_drones_add_route_fields",            _m0002_drones_add_route_fields),
    ("0003_drones_add_battery_physics",         _m0003_drones_add_battery_physics),
    ("0004_deliveries_add_fields",              _m0004_deliveries_add_fields),
    ("0005_missions_add_progress_fields",       _m0005_missions_add_progress_fields),
    ("0006_rename_legacy_status_values",        _m0006_rename_legacy_status_values),
    ("0007_create_alerts_table",               _m0007_create_alerts_table),
    ("0008_missions_add_per_leg_fields",        _m0008_missions_add_per_leg_fields),
    ("0009_deliveries_add_pod_fields",          _m0009_deliveries_add_pod_fields),
    ("0010_create_audit_logs_table",            _m0010_create_audit_logs_table),
    ("0011_fix_missions_status_constraint",     _m0011_fix_missions_status_constraint),
    ("0012_deliveries_add_failure_reason",      _m0012_deliveries_add_failure_reason),
    ("0013_users_add_last_login",               _m0013_users_add_last_login),
    ("0014_alerts_update_status_and_grouping",  _m0014_alerts_update_status_and_grouping),
    ("0015_fix_drones_status_constraint",       _m0015_fix_drones_status_constraint),
    ("0016_add_planned_route_path",             _m0016_add_planned_route_path),
    ("0017_add_start_flight_km",                _m0017_add_start_flight_km),
    ("0018_add_paused_to_missions_status",      _m0018_add_paused_to_missions_status),
    ("0019_fix_deliveries_weight_constraint",   _m0019_fix_deliveries_weight_constraint),
    ("0020_simplify_delivery_priorities",       _m0020_simplify_delivery_priorities),
    ("0021_drones_add_maintenance_source",      _m0021_drones_add_maintenance_source),
    ("0022_deliveries_add_address_fields",      _m0022_deliveries_add_address_fields),
    ("0023_deliveries_add_dropoff_safety_fields", _m0023_deliveries_add_dropoff_safety_fields),
]


def run_migrations(engine: Engine) -> None:
    """
    Aplică toate migrarile neaplicate încă.
    Idempotent: poate fi apelat la fiecare pornire fără efecte secundare.
    """
    with engine.begin() as conn:

        timestamp_type = "TIMESTAMP" if conn.dialect.name == "postgresql" else "DATETIME"
        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS _migrations (
                name       TEXT PRIMARY KEY,
                applied_at {timestamp_type} DEFAULT CURRENT_TIMESTAMP
            )
        """))

        applied = {
            row[0]
            for row in conn.execute(text("SELECT name FROM _migrations")).fetchall()
        }
 
        new_count = 0
        for name, fn in MIGRATIONS:
            if name in applied:
                continue
            try:
                fn(conn)
                conn.execute(
                    text("INSERT INTO _migrations (name) VALUES (:name)"),
                    {"name": name},
                )
                print(f"[Migration] Applied: {name}")
                new_count += 1
            except Exception as exc:
                print(f"[Migration] ERROR at {name}: {exc}")
                raise

        if new_count:
            print(f"[Migration] {new_count} migration(s) applied successfully.")
        else:
            print("[Migration] Schema is up to date, no migrations needed.")
