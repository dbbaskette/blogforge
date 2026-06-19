import json
import os

from blogforge.config.tanzu import apply_vcap_services

_S3_ENV = (
    "BLOGFORGE_S3_ENDPOINT_URL",
    "BLOGFORGE_S3_ACCESS_KEY",
    "BLOGFORGE_S3_SECRET_KEY",
    "BLOGFORGE_S3_BUCKET",
    "BLOGFORGE_S3_REGION",
    "BLOGFORGE_S3_VERIFY_SSL",
)


def _seaweedfs_vcap() -> str:
    # Real ndc shape: the `seaweedfs` offering (instance `blogforge-s3`). The
    # broker provisions a bucket named after the instance GUID and serves an
    # https endpoint behind a self-signed cert.
    return json.dumps({
        "seaweedfs": [{
            "name": "blogforge-s3",
            "credentials": {
                "endpoint": "seaweedfs-s3.example.com",
                "endpoint_url": "https://seaweedfs-s3.example.com",
                "access_key": "AK",
                "secret_key": "SK",
                "bucket": "cf-deadbeef",
                "region": "us-east-1",
                "use_ssl": True,
            },
        }]
    })


def test_s3_binding_adopts_endpoint_bucket_and_disables_tls_verify(monkeypatch) -> None:
    for key in _S3_ENV:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("VCAP_SERVICES", _seaweedfs_vcap())

    apply_vcap_services()

    # Prefer the https endpoint_url (the bare `endpoint` is scheme-less).
    assert os.environ["BLOGFORGE_S3_ENDPOINT_URL"] == "https://seaweedfs-s3.example.com"
    # Adopt the broker-provisioned bucket, not the local default.
    assert os.environ["BLOGFORGE_S3_BUCKET"] == "cf-deadbeef"
    # Self-signed internal cert → verification off for the bound instance.
    assert os.environ["BLOGFORGE_S3_VERIFY_SSL"] == "false"


def test_s3_binding_respects_operator_overrides(monkeypatch) -> None:
    # `_set_if_unset` must never clobber an explicit `cf set-env` — an operator
    # who installs the foundation CA can re-enable verification.
    for key in _S3_ENV:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("BLOGFORGE_S3_VERIFY_SSL", "true")
    monkeypatch.setenv("VCAP_SERVICES", _seaweedfs_vcap())

    apply_vcap_services()

    assert os.environ["BLOGFORGE_S3_VERIFY_SSL"] == "true"
