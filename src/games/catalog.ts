import type { GameId } from './engine'

export const games: { id: GameId; title: string; description: string }[] = [
  { id: 'snake', title: '贪吃蛇', description: '吃掉食物，避开墙壁和自己' },
  { id: '2048', title: '2048', description: '滑动数字，合并至 2048' },
]
