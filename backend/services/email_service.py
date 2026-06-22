"""
Email service for sending transactional emails (e.g. delivery confirmation codes).
Uses Python's built-in smtplib with STARTTLS.

Required .env variables:
    SMTP_HOST     – e.g. smtp.gmail.com
    SMTP_PORT     – e.g. 587
    SMTP_USER     – sender email address
    SMTP_PASSWORD – app password (Gmail) or SMTP password
    SMTP_FROM     – display name + address, e.g. "DroneDelivery <noreply@example.com>"

If SMTP_HOST / SMTP_USER are not set, sending is skipped and a warning is logged.
"""
import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logger = logging.getLogger(__name__)

_SMTP_HOST = os.getenv("SMTP_HOST", "")
_SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
_SMTP_USER = os.getenv("SMTP_USER", "")
_SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
_SMTP_FROM = os.getenv("SMTP_FROM", _SMTP_USER)


def _parse_bool(value: str, default: bool = False) -> bool:
  if value is None:
    return default
  value = str(value).strip().lower()
  if value in {"1", "true", "yes", "on"}:
    return True
  if value in {"0", "false", "no", "off"}:
    return False
  return default


def _smtp_settings() -> dict:
  """Loads SMTP settings dynamically so .env changes are picked without restart."""
  host = os.getenv("SMTP_HOST", "").strip()
  port = int(os.getenv("SMTP_PORT", "587"))
  user = os.getenv("SMTP_USER", "").strip()
  password = os.getenv("SMTP_PASSWORD", "")
  from_addr = os.getenv("SMTP_FROM", user).strip()


  use_ssl = _parse_bool(os.getenv("SMTP_USE_SSL"), default=(port == 465))
  use_starttls = _parse_bool(os.getenv("SMTP_USE_STARTTLS"), default=(not use_ssl and port in (25, 587, 2525)))

  return {
    "host": host,
    "port": port,
    "user": user,
    "password": password,
    "from": from_addr,
    "use_ssl": use_ssl,
    "use_starttls": use_starttls,
  }


def _is_configured(cfg: dict) -> bool:
  return bool(cfg["host"] and cfg["user"] and cfg["password"])


def send_email(to: str, subject: str, html_body: str, text_body: str = "") -> bool:
    """
    Sends an email. Returns True on success, False on failure.
    Silently skips if SMTP is not configured.
    """
    cfg = _smtp_settings()

    if not to or "@" not in to:
      logger.error("Invalid recipient email '%s' for subject '%s'", to, subject)
      return False

    if not _is_configured(cfg):
        logger.warning(
            "SMTP not configured – skipping email to %s (subject: %s). "
        "Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD in .env.",
            to, subject,
        )
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg["from"]
    msg["To"] = to

    if text_body:
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
      if cfg["use_ssl"]:
        with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=12) as server:
          server.ehlo()
          server.login(cfg["user"], cfg["password"])
          server.sendmail(cfg["user"], [to], msg.as_bytes())
      else:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=12) as server:
          server.ehlo()
          if cfg["use_starttls"]:
            server.starttls()
            server.ehlo()
          server.login(cfg["user"], cfg["password"])
          server.sendmail(cfg["user"], [to], msg.as_bytes())
        logger.info("Email sent to %s – %s", to, subject)
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)
        return False


def send_delivery_confirmation_code(
    recipient_email: str,
    recipient_name: str,
    delivery_id: int,
    confirmation_code: str,
) -> bool:
    """
    Sends the 6-digit confirmation code to the customer when the drone
    arrives at the destination and the delivery is marked as DELIVERED.
    """
    subject = f"Codul tău de confirmare pentru comanda #{delivery_id}"

    html_body = f"""
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cod de confirmare livrare</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
                       padding:32px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
                <tr>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                  <td style="width:10px;"></td>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                </tr>
                <tr>
                  <td style="height:6px;"></td>
                  <td style="width:18px;height:18px;border-radius:6px;background:#ffffff;"></td>
                  <td style="height:6px;"></td>
                </tr>
                <tr>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                  <td style="width:10px;"></td>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                </tr>
              </table>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;
                         letter-spacing:0.5px;">Drone Delivery</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#2d3748;font-size:16px;">
                Bună, <strong>{recipient_name}</strong>!
              </p>
              <p style="margin:0 0 24px;color:#4a5568;font-size:15px;line-height:1.6;">
                Drona a ajuns la destinație cu comanda ta <strong>#{delivery_id}</strong>! 🎉<br/>
                Introdu <strong>codul de confirmare</strong> de mai jos pentru a valida
                primirea coletului și a finaliza livrarea.
              </p>

              <!-- Code box -->
              <div style="background:#f7fafc;border:2px dashed #4299e1;border-radius:10px;
                          padding:28px;text-align:center;margin:0 0 28px;">
                <p style="margin:0 0 8px;color:#718096;font-size:13px;
                           text-transform:uppercase;letter-spacing:1px;">
                  Cod de confirmare
                </p>
                <span style="font-size:42px;font-weight:800;letter-spacing:10px;
                             color:#1a365d;font-family:'Courier New',monospace;">
                  {confirmation_code}
                </span>
              </div>

              <p style="margin:0 0 12px;color:#4a5568;font-size:14px;line-height:1.6;">
                <strong>Cum funcționează:</strong>
              </p>
              <ol style="margin:0 0 24px;padding-left:20px;color:#4a5568;font-size:14px;line-height:1.8;">
                <li>Drona ajunge la destinație și afișează o solicitare de confirmare.</li>
                <li>Tu (sau destinatarul) introduci codul de 6 cifre de mai sus.</li>
                <li>Livrarea este marcată ca finalizată și coletul este eliberat.</li>
              </ol>

              <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;
                         background:#fff5f5;border-left:3px solid #fc8181;
                         padding:12px 16px;border-radius:4px;">
                ⚠️ Păstrează acest cod în siguranță. Nu îl distribui altor persoane
                decât destinatarului autorizat.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f7fafc;padding:20px 40px;text-align:center;
                       border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#a0aec0;font-size:12px;">
                Ai primit acest email deoarece ai plasat o comandă pe platforma Drone Delivery.<br/>
                Dacă nu ai plasat tu această comandă, te rugăm să contactezi suportul.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    text_body = (
        f"Bună, {recipient_name}!\n\n"
        f"Drona a ajuns la destinație cu comanda ta #{delivery_id}!\n\n"
        f"Codul tău de confirmare este: {confirmation_code}\n\n"
        f"Introdu acest cod pentru a valida primirea coletului și a finaliza livrarea.\n\n"
        f"Dacă nu ai plasat tu această comandă, te rugăm să contactezi suportul.\n\n"
        f"— Echipa Drone Delivery"
    )

    return send_email(recipient_email, subject, html_body, text_body)


def send_order_created_email(
    recipient_email: str,
    recipient_name: str,
    delivery_id: int,
) -> bool:
    """Sends a regular order confirmation email right after order creation."""
    subject = f"Comanda ta #{delivery_id} a fost înregistrată"

    html_body = f"""
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirmare comandă</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
                       padding:32px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
                <tr>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                  <td style="width:10px;"></td>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                </tr>
                <tr>
                  <td style="height:6px;"></td>
                  <td style="width:18px;height:18px;border-radius:6px;background:#ffffff;"></td>
                  <td style="height:6px;"></td>
                </tr>
                <tr>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                  <td style="width:10px;"></td>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                </tr>
              </table>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;
                         letter-spacing:0.5px;">Drone Delivery</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#2d3748;font-size:16px;">
                Bună, <strong>{recipient_name}</strong>!
              </p>
              <p style="margin:0 0 20px;color:#4a5568;font-size:15px;line-height:1.6;">
                Comanda ta <strong>#{delivery_id}</strong> a fost înregistrată cu succes.
              </p>
              <p style="margin:0 0 20px;color:#4a5568;font-size:14px;line-height:1.6;">
                Mulțumim că ai ales AeroFlow.
              </p>
              <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;
                         background:#f7fafc;border-left:3px solid #4299e1;
                         padding:12px 16px;border-radius:4px;">
                Cu respect,<br/>
                Echipa AeroFlow
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f7fafc;padding:20px 40px;text-align:center;
                       border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#a0aec0;font-size:12px;">
                Ai primit acest email deoarece ai plasat o comandă pe platforma Drone Delivery.<br/>
                Dacă nu ai plasat tu această comandă, te rugăm să contactezi suportul.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    text_body = (
        f"Bună, {recipient_name}!\n\n"
        f"Comanda ta #{delivery_id} a fost înregistrată cu succes.\n\n"
      "Mulțumim că ai ales AeroFlow.\n\n"
      "Cu respect,\n"
      "Echipa AeroFlow"
    )

    return send_email(recipient_email, subject, html_body, text_body)


def send_password_reset_email(
    recipient_email: str,
    recipient_name: str,
    reset_code: str,
) -> bool:
    """
    Sends a 6-digit password reset code to the user's email.
    """
    subject = "Resetare parolă – AeroFlow"

    html_body = f"""
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resetare parolă</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
                       padding:32px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
                <tr>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                  <td style="width:10px;"></td>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                </tr>
                <tr>
                  <td style="height:6px;"></td>
                  <td style="width:18px;height:18px;border-radius:6px;background:#ffffff;"></td>
                  <td style="height:6px;"></td>
                </tr>
                <tr>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                  <td style="width:10px;"></td>
                  <td style="width:12px;height:12px;border-radius:50%;background:#6ae4ff;"></td>
                </tr>
              </table>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;
                         letter-spacing:0.5px;">AeroFlow</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#2d3748;font-size:16px;">
                Bună, <strong>{recipient_name}</strong>!
              </p>
              <p style="margin:0 0 24px;color:#4a5568;font-size:15px;line-height:1.6;">
                Am primit o solicitare de resetare a parolei pentru contul tău.<br/>
                Folosește <strong>codul de mai jos</strong> pentru a seta o parolă nouă.
              </p>

              <!-- Code box -->
              <div style="background:#f7fafc;border:2px dashed #4299e1;border-radius:10px;
                          padding:28px;text-align:center;margin:0 0 28px;">
                <p style="margin:0 0 8px;color:#718096;font-size:13px;
                           text-transform:uppercase;letter-spacing:1px;">
                  Cod de resetare
                </p>
                <span style="font-size:42px;font-weight:800;letter-spacing:10px;
                             color:#1a365d;font-family:'Courier New',monospace;">
                  {reset_code}
                </span>
              </div>

              <p style="margin:0 0 12px;color:#4a5568;font-size:14px;line-height:1.6;">
                Codul expiră în <strong>15 minute</strong>.
              </p>

              <p style="margin:0;color:#718096;font-size:13px;line-height:1.5;
                         background:#fff5f5;border-left:3px solid #fc8181;
                         padding:12px 16px;border-radius:4px;">
                ⚠️ Dacă nu ai solicitat resetarea parolei, ignoră acest email.
                Nimeni nu poate accesa contul tău fără acest cod.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f7fafc;padding:20px 40px;text-align:center;
                       border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#a0aec0;font-size:12px;">
                Ai primit acest email deoarece ai solicitat resetarea parolei pe platforma AeroFlow.<br/>
                Dacă nu ai fost tu, te rugăm să contactezi suportul.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    text_body = (
        f"Bună, {recipient_name}!\n\n"
        f"Am primit o solicitare de resetare a parolei pentru contul tău.\n\n"
        f"Codul tău de resetare este: {reset_code}\n\n"
        f"Codul expiră în 15 minute.\n\n"
        f"Dacă nu ai solicitat resetarea parolei, ignoră acest email.\n\n"
        f"— Echipa AeroFlow"
    )

    return send_email(recipient_email, subject, html_body, text_body)
