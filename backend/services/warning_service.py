import threading
import time
import logging
import requests
import xml.etree.ElementTree as ET
import html
import re

logger = logging.getLogger(__name__)

URL_GENERAL = "https://www.meteoromania.ro/avertizari-xml.php"
URL_NOWCAST = "https://www.meteoromania.ro/avertizari-nowcasting-xml.php"

UPDATE_INTERVAL_SEC = 300

_warnings_cache = {
    "general": [],
    "nowcast": [],
    "last_updated": 0
}
_updater_thread = None


def _clean_html(raw_html: str) -> str:
    """Removes HTML tags from a string and unescapes HTML entities."""
    if not raw_html:
        return ""
    text = html.unescape(raw_html)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _fetch_warnings(url: str, root_tag: str) -> list:
    """Fetches and parses XML warnings from the given ANM endpoint."""
    warnings = []
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            logger.warning(f"Failed to fetch warnings from {url}: {resp.status_code}")
            return warnings

        root = ET.fromstring(resp.content)

        child_tag = "avertizare" if "nowcasting" not in url.lower() else "avertizareNowcasting"
        
        for elem in root.findall(child_tag):
            attr = elem.attrib
            

            mesaj_html = attr.get('mesaj') or elem.text or ""
            clean_message = _clean_html(mesaj_html)
            
            w = {
                "tip": attr.get("numeTipMesaj", "Avertizare"),
                "culoare": attr.get("numeCuloare", "Galben"),
                "data_aparitiei": attr.get("dataAparitiei", ""),
                "data_expirarii": attr.get("dataExpirarii", ""),
                "fenomene": attr.get("fenomeneVizate", ""),
                "zone": attr.get("zonaAfectata", ""),
                "mesaj": clean_message
            }
            warnings.append(w)
            
    except Exception as e:
        logger.error(f"Error parsing warnings from {url}: {e}")
        
    return warnings


def _updater_loop():
    while True:
        try:
            gen_warns = _fetch_warnings(URL_GENERAL, "avertizari")
            now_warns = _fetch_warnings(URL_NOWCAST, "avertizariNowcasting")
            
            _warnings_cache["general"] = gen_warns
            _warnings_cache["nowcast"] = now_warns
            _warnings_cache["last_updated"] = time.time()
            
            logger.info(f"Weather warnings updated. General: {len(gen_warns)}, Nowcast: {len(now_warns)}")
        except Exception as e:
            logger.error(f"Failed to update weather warnings: {e}")
        
        time.sleep(UPDATE_INTERVAL_SEC)


def start_warning_service():
    """Starts the background thread to fetch weather warnings."""
    global _updater_thread
    if _updater_thread is None:
        _updater_thread = threading.Thread(target=_updater_loop, daemon=True)
        _updater_thread.start()


def get_active_warnings() -> dict:
    """Returns the currently cached weather warnings."""
    return _warnings_cache
