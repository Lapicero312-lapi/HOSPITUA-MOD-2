export interface ChannexRoomType {
  id: string;
  propertyId: string;
  title: string;
  defaultOccupancy: number;
}

export interface ChannexRoomTypeInput {
  propertyId: string;
  title: string;
  countOfRooms: number;
  occAdults: number;
  occChildren: 0;
  occInfants: 0;
  defaultOccupancy: number;
  roomKind: 'room';
}

export interface ChannexPort {
  listRoomTypes(propertyId: string): Promise<ChannexRoomType[]>;
  createRoomType(input: ChannexRoomTypeInput): Promise<{ id: string }>;
  updateRoomType(
    channexRoomTypeId: string,
    input: ChannexRoomTypeInput,
  ): Promise<void>;
}
