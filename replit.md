# Generator - Exam Preparation App

## Overview
A Django + React application for exam preparation (ОГЭ/ЕГЭ). Users can select exam type, subject, generate exam variants, and practice with answer checking. Includes PDF generation for exam variants and a collaborative drawing board via WebSocket.

## Project Architecture
- **Backend**: Django (Python) running on port 8000
  - Settings: `Generator/Generator/settings.py` (also duplicated at `Generator/settings.py`)
  - Main URLs: `Generator/Generator/urls.py` and `Generator/urls.py`
  - Models: `Generator/Generator/models.py` - Level, Subject, TaskList, Task, Variant, VariantContent, Tags
  - Views: `Generator/Generator/views.py` - API endpoints and HTML views
  - Board app: `Generator/Board/` - WebSocket-based collaborative drawing board
- **Frontend**: React + Vite running on port 5000
  - Entry: `frontend/src/main.jsx`
  - Pages: IndexPage, SubjectPage, TasksPage, ExamPage
  - Vite proxies `/api/` and `/media/` requests to Django backend on port 8000
- **Database**: PostgreSQL (Replit built-in, Neon-backed)

## Key Dependencies
- Backend: Django, django-cors-headers, django-ckeditor-5, weasyprint, psycopg2-binary, channels
- Frontend: React, react-router-dom, mathjax-full, Vite

## Recent Changes
- 2026-02-19: Configured for Replit environment
  - Updated Django settings: ALLOWED_HOSTS=["*"], CORS_ALLOW_ALL_ORIGINS, DB from env vars
  - Vite configured on port 5000 with host 0.0.0.0 and allowedHosts: true
  - Fixed hardcoded localhost URLs in ExamPage.jsx to use relative paths through Vite proxy
  - Added API-prefixed PDF URL routes in Django for Vite proxy compatibility

## Workflows
- **Django Backend**: `python manage.py runserver 0.0.0.0:8000` (port 8000, runs from project root)
- **Frontend**: `cd frontend && npm run dev` (port 5000, webview)

## Environment Setup (Replit)
- Database: Replit built-in PostgreSQL, credentials set via PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT env vars
- Migrations applied: all 28 migrations (Generator app + Django built-ins)
- Python deps installed via pip from requirements.txt
- Node deps installed via npm in frontend/
