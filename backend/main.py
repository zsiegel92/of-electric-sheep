from typing import Annotated

from fastapi import Depends, FastAPI, Response
from psycopg import AsyncConnection
from pydantic import BaseModel, ConfigDict

from backend.auth import User, get_user, require_auth
from backend.frontend import router as frontend_router
from backend.oauth import auth_app
from backend.settings import settings

app = FastAPI(
    title="Of Electric Sheep",
    dependencies=[Depends(require_auth)],
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
)
app.mount("/auth", auth_app)


class Viewer(BaseModel):
    model_config = ConfigDict(strict=True)

    user: User
    database: str


class ApiError(BaseModel):
    detail: str


@app.get("/api/viewer", operation_id="getViewer", responses={401: {"model": ApiError}})
async def viewer(
    user: Annotated[User, Depends(get_user)], response: Response
) -> Viewer:
    response.headers["Cache-Control"] = "no-store"
    async with (
        await AsyncConnection.connect(str(settings().database_url)) as connection,
        connection.cursor() as cursor,
    ):
        await cursor.execute("select current_database()")
        row = await cursor.fetchone()
    if row is None:
        raise RuntimeError("PostgreSQL did not return a database name")
    return Viewer(user=user, database=row[0])


app.include_router(frontend_router)
