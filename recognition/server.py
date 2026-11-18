"""Punto de entrada: `uvicorn server:app --host 127.0.0.1 --port 8001`"""
from app.main import build_default_app

app = build_default_app()
