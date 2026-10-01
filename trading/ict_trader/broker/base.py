"""The broker interface the live runner depends on."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from ..sessions import Bar


@dataclass(frozen=True)
class BrokerPosition:
    ticket: int
    direction: int
    lots: float
    entry_price: float
    stop: float
    target: float
    open_time: datetime


@dataclass(frozen=True)
class SymbolSpec:
    bid: float
    ask: float
    # Account-currency value of a 1.0 price move on 1.0 lot.
    value_per_price_unit_per_lot: float
    volume_step: float
    min_lots: float
    max_lots: float
    digits: int


class Broker(Protocol):
    def connect(self) -> None: ...
    def is_real_account(self) -> bool: ...
    def closed_bars(self, count: int) -> list[Bar]: ...
    def equity(self) -> float: ...
    def symbol_spec(self) -> SymbolSpec: ...
    def open_positions(self) -> list[BrokerPosition]: ...
    def market_order(self, direction: int, lots: float, stop: float, target: float, comment: str) -> int: ...
    def close_position(self, position: BrokerPosition, comment: str) -> None: ...
    def realized_pnl(self, ticket: int) -> float | None: ...
