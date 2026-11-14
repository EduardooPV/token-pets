import { paletteFor } from "./personality";
import { GRID, buildFrame, drawGrid, type Character, type Costume, type PetState } from "./sprites";

// Rasteriza cada combinação uma vez; mover oito pets custa oito drawImage, em vez de centenas de fillRect.
const sprites = new Map<string, HTMLCanvasElement>();
const MAX_CACHED_SPRITES = 256;

export function drawSprite(ctx: CanvasRenderingContext2D, character: Character, state: PetState, frame: number,
  costume: Costume, color: string | null, x: number, y: number, scale: number): void {
  const key = `${character}|${state}|${frame}|${costume}|${color}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = GRID;
    drawGrid(sprite.getContext("2d")!, buildFrame(character, state, frame, costume), 0, 0, 1, paletteFor(character, color));
    if (sprites.size >= MAX_CACHED_SPRITES) sprites.delete(sprites.keys().next().value!);
    sprites.set(key, sprite);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, x, y, GRID * scale, GRID * scale);
}
