import reflex as rx


config = rx.Config(
    app_name="main",
    disable_plugins=["reflex.plugins.sitemap.SitemapPlugin"],
    state_auto_setters=True,
)
