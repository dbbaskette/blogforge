"""Pencraft CLI entry point."""
from __future__ import annotations

import click
import uvicorn

from pencraft import __version__
from pencraft.server import create_app


@click.group()
@click.version_option(__version__, prog_name="pencraft")
def main() -> None:
    """Pencraft — long-form drafting in your voice."""


@main.command()
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=7880, show_default=True, type=int)
@click.option("--dev/--prod", default=False, help="Dev mode: skip browser open.")
@click.option("--no-browser/--browser", default=False)
def serve(host: str, port: int, dev: bool, no_browser: bool) -> None:
    """Start the Pencraft server."""
    app = create_app()
    if not (dev or no_browser):
        import webbrowser

        webbrowser.open(f"http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


@main.command(name="serve-linkedin")
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=7890, show_default=True, type=int)
def serve_linkedin(host: str, port: int) -> None:
    """Start the LinkedIn connector server (separate process from the API)."""
    from pencraft.linkedin.app import create_linkedin_app

    app = create_linkedin_app()
    uvicorn.run(app, host=host, port=port, log_level="info")


@main.command()
def version() -> None:
    """Print the installed version."""
    click.echo(__version__)


if __name__ == "__main__":
    main()
