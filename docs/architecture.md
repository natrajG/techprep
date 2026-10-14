# Architecture Overview

## High-level flow

1. Candidate interview session is created in **FastAPI**.
2. Candidate responses are sent to **Flask AI service** for rubric scoring and feedback generation.
3. Session metadata and results are stored in **PostgreSQL**.
4. Admin/recruiters use **React UI** and **Django admin portal** for management/reporting.

## Service boundaries

- **api-fastapi**
  - REST API gateway
  - session lifecycle management
  - candidate/report endpoints
- **ai-flask**
  - prompt templates
  - scoring logic
  - optional provider adapters (OpenAI/Azure OpenAI)
- **admin-django**
  - admin users, permissions, operational dashboards
  - enterprise integration surface
- **react-web**
  - interview UI, recruiter review UI

## Databases

- **PostgreSQL**: single source of truth

## Deployment strategy

- Containerized services
- Separate environments: dev/stage/prod
- CI pipeline: lint + unit tests + build
- CD target: AWS ECS/EKS or Azure App Service/AKS
