"""
Route handlers for the rooms resource.

Manages CRUD operations on the `rooms` table.  A room represents a physical
study space identified by a slug-format ID (e.g. `library_floor_2`).
"""

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import Room, get_db
from app.models import RoomCreate, RoomResponse

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

DB = Annotated[AsyncSession, Depends(get_db)]


def _slugify(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"\s+", "_", slug)
    slug = re.sub(r"[^a-z0-9_]", "", slug)
    return slug


@router.get("", response_model=list[RoomResponse])
async def list_rooms(db: DB):
    result = await db.execute(select(Room).order_by(Room.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(body: RoomCreate, db: DB):
    room_id = _slugify(body.name)

    existing = await db.execute(select(Room).where(Room.id == room_id))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Room with this ID already exists",
        )

    room = Room(id=room_id, name=body.name)
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return room


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(room_id: str, db: DB):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(room_id: str, db: DB):
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    await db.delete(room)
    await db.commit()
