export const TUNNEL_WIDTH = 1.5;
export const TUNNEL_HEIGHT = 2;
export const TUNNEL_LENGTH = 4;

export const SECTION_TYPES = {
  STRAIGHT: 'straight',
  JUNCTION: 'junction',
  CORNER: 'corner',
  CORNER_ROUND: 'corner_round',
  S_PIECE: 's_piece',
};

export function getConnectors(type) {
  const hl = TUNNEL_LENGTH / 2;
  const hw = TUNNEL_WIDTH / 2;

  switch (type) {
    case SECTION_TYPES.STRAIGHT:
      return [
        { id: 'front', position: [0, 0, -hl], direction: [0, 0, -1] },
        { id: 'back',  position: [0, 0,  hl], direction: [0, 0,  1] },
      ];

    case SECTION_TYPES.JUNCTION:
      return [
        { id: 'front', position: [0, 0, -hl], direction: [0, 0, -1] },
        { id: 'back',  position: [0, 0,  hl], direction: [0, 0,  1] },
        { id: 'left',  position: [-hl, 0, 0], direction: [-1, 0,  0] },
        { id: 'right', position: [ hl, 0, 0], direction: [ 1, 0,  0] },
      ];

    case SECTION_TYPES.CORNER:
    case SECTION_TYPES.CORNER_ROUND:
      // 90° turn from "front" (-z) to "right" (+x)
      return [
        { id: 'front', position: [0, 0, -hl], direction: [0, 0, -1] },
        { id: 'right', position: [ hl, 0, 0], direction: [ 1, 0,  0] },
      ];

    case SECTION_TYPES.S_PIECE:
      // Same direction at both ends, laterally offset by W
      return [
        { id: 'front', position: [-hw, 0, -hl], direction: [0, 0, -1] },
        { id: 'back',  position: [ hw, 0,  hl], direction: [0, 0,  1] },
      ];

    default:
      return [];
  }
}
