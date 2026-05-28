"""LinkedIn connector — personal-profile posting + basic engagement stats.

Runs as a separate FastAPI app (create_linkedin_app) off the same wheel as
the core API, started via `pencraft serve-linkedin`. Reuses Pencraft's
SecretCipher, db layer, session signing, and ORM models.
"""
