from fastapi import Depends, FastAPI

from backend.api_keys import router as api_keys_router
from backend.auth import get_user
from backend.frontend import router as frontend_router
from backend.oauth import auth_router
from backend.system_one import router as system_one_router
from backend.ui import router as ui_router

app = FastAPI(
    title="Of Electric Sheep API", docs_url=None, openapi_url=None, redoc_url=None
)
app.include_router(auth_router)
app.include_router(api_keys_router)
app.include_router(system_one_router)
app.include_router(ui_router)
app.include_router(frontend_router)


@app.middleware("http")
async def no_store_api(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/api/health", include_in_schema=False)
def health():
    return {"status": "ok"}


@app.get("/api/openapi.json", include_in_schema=False, dependencies=[Depends(get_user)])
def openapi():
    return app.openapi()


@app.get("/api/docs", include_in_schema=False, dependencies=[Depends(get_user)])
def docs():
    from fastapi.openapi.docs import get_swagger_ui_html

    return get_swagger_ui_html(openapi_url="/api/openapi.json", title=app.title)
