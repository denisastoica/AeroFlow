import json
import os
from threading import Lock

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "settings.json")


DEFAULT_SETTINGS = {
    "critical_battery": 15,
    "max_wind": 45,
    "maintenance_interval": 500,
}

_settings_lock = Lock()
_settings_cache = None

def get_settings():
    global _settings_cache
    with _settings_lock:
        if _settings_cache is not None:
            return _settings_cache
            
        if not os.path.exists(os.path.dirname(SETTINGS_FILE)):
            os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
            
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r") as f:
                    _settings_cache = json.load(f)

                    for k, v in DEFAULT_SETTINGS.items():
                        if k not in _settings_cache:
                            _settings_cache[k] = v
                    return _settings_cache
            except Exception:
                pass
                
        _settings_cache = DEFAULT_SETTINGS.copy()
        return _settings_cache

def update_settings(new_settings: dict):
    global _settings_cache
    with _settings_lock:
        current = _settings_cache.copy() if _settings_cache else DEFAULT_SETTINGS.copy()
        current.update(new_settings)
        _settings_cache = current
        
        with open(SETTINGS_FILE, "w") as f:
            json.dump(_settings_cache, f, indent=2)
            
        return _settings_cache
