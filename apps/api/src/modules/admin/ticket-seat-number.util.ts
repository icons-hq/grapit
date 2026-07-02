export type TicketSeatNumberInput = {
  floorLabel: string;
  tierName: string;
  row: string;
  number: string;
};

export function formatTicketSeatNumber(input: TicketSeatNumberInput): string {
  return [
    input.floorLabel,
    input.tierName,
    `${input.row}열`,
    `${input.number}번`,
  ].filter(Boolean).join(' ');
}
