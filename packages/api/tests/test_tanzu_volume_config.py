"""Tanzu Block Storage: a bound volume service mounts a dir into the container;
the VCAP adapter points the fs blob store at <mount>/blobs. The volume takes
precedence over an object-storage (SeaweedFS) binding."""

import json
import os

from blogforge.config.tanzu import apply_vcap_services

_ENV = (
    "BLOGFORGE_STORAGE_BACKEND",
    "BLOGFORGE_STORAGE_DIR",
    "BLOGFORGE_S3_ENDPOINT_URL",
)


def _volume_vcap() -> str:
    # CF volume services expose `volume_mounts` as a top-level key on the binding.
    return json.dumps({
        "block-storage": [{
            "name": "blogforge-blobs",
            "volume_mounts": [
                {"container_dir": "/var/vcap/data/abc123", "mode": "rw", "device_type": "shared"}
            ],
        }]
    })


def test_bound_volume_selects_fs_backend_at_mount(monkeypatch) -> None:
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("VCAP_SERVICES", _volume_vcap())

    apply_vcap_services()

    assert os.environ["BLOGFORGE_STORAGE_BACKEND"] == "fs"
    assert os.environ["BLOGFORGE_STORAGE_DIR"] == "/var/vcap/data/abc123/blobs"


def test_volume_wins_over_object_storage(monkeypatch) -> None:
    # Both bound: _apply_volume runs first, so _apply_s3 can't flip the backend
    # (guarded by _set_if_unset). fs wins.
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    both = {
        "block-storage": [{
            "name": "blogforge-blobs",
            "volume_mounts": [{"container_dir": "/vol", "mode": "rw"}],
        }],
        "seaweedfs": [{
            "name": "blogforge-s3",
            "credentials": {"endpoint_url": "https://s3.example.com"},
        }],
    }
    monkeypatch.setenv("VCAP_SERVICES", json.dumps(both))

    apply_vcap_services()

    assert os.environ["BLOGFORGE_STORAGE_BACKEND"] == "fs"
    assert os.environ["BLOGFORGE_STORAGE_DIR"] == "/vol/blobs"


def test_operator_storage_backend_override_is_respected(monkeypatch) -> None:
    # An explicit `cf set-env BLOGFORGE_STORAGE_BACKEND s3` must not be clobbered.
    for k in _ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("BLOGFORGE_STORAGE_BACKEND", "s3")
    monkeypatch.setenv("VCAP_SERVICES", _volume_vcap())

    apply_vcap_services()

    assert os.environ["BLOGFORGE_STORAGE_BACKEND"] == "s3"
