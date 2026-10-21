export interface SellableRoom {
  id: string;
  roomNumber: string;
  categoryRoom: string;
  maxCapacity: number;
}

export interface ConsultRoomInventory {
  listAll(): Promise<SellableRoom[]>;
}
