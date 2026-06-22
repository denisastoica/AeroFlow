"""
Centralized geographic coordinates for Romanian cities.

Single source of truth — import CITY_COORDS in charging_stations.py,
fleet_reset_service.py, demo_scenarios.py, and anywhere else city
coordinates are needed. Never hardcode coordinates in multiple files.
"""

CITY_COORDS: dict[str, tuple[float, float]] = {
    "Alba Iulia":   (46.0667, 23.5833),
    "Fagaras":      (45.8416, 24.9731),
    "Sibiu":        (45.7983, 24.1256),
    "Brasov":       (45.6528, 25.6012),
    "Ploiesti":     (44.9400, 26.0200),
    "Cluj-Napoca":  (46.7712, 23.6236),
    "Targu Mures":  (46.5386, 24.5514),

    "Timisoara":    (45.7489, 21.2087),
    "Arad":         (46.1866, 21.3123),
    "Oradea":       (47.0465, 21.9189),
    "Iasi":         (47.1585, 27.5931),
    "Piatra Neamt": (46.9300, 26.3700),
    "Suceava":      (47.6400, 26.2553),
    "Bucharest":    (44.4268, 26.1025),
    "Craiova":      (44.3200, 23.7945),
    "Constanta":    (44.1598, 28.6348),
    "Galati":       (45.2667, 27.9833),
    "Bistrita":     (46.7700, 25.7900),
    "Bacau":        (46.5700, 26.9100),
    "Targu Jiu":    (45.0423, 23.2728),
    "Baia Mare":    (47.6567, 23.5850),
    "Hunedoara":    (45.7597, 22.8953),
}
