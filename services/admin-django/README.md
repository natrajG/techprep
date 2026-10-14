# Django Admin Service (Bootstrap)

This folder is reserved for Django admin/auth service.

## Bootstrap

```bash
python -m venv .venv
source .venv/bin/activate
pip install django djangorestframework psycopg2-binary
django-admin startproject admin_portal .
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8200
```

## Purpose

- Admin user/role management
- Audit and operational dashboards
- Enterprise auth integration (SSO/OIDC) in later phase
