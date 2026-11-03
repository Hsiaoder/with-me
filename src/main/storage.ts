import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAVE_FILE } from '../shared/config.js'
import { defaultSave, migrate, toSaveFile, type SaveData } from '../shared/save.js'

/**
 * 存档落盘。两条规矩：
 * ① **原子写**——先写 `.tmp` 再 `rename`。直接覆写主文件的话，写到一半断电
 *    或进程被杀，留下的就是半个 JSON，下次启动直接读不出来。
 * ② **覆盖前留档**——把上一版复制成 `.bak`，主文件坏了还能回退。
 */

const fileOf = (dir: string): string => join(dir, SAVE_FILE)
const backupOf = (dir: string): string => join(dir, `${SAVE_FILE}.bak`)
const tmpOf = (dir: string): string => join(dir, `${SAVE_FILE}.tmp`)

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * @param now 写盘时刻，用来刷新 lastSeenAt；测试里传固定值
 * @returns 是否真的写了。读到来历不明的未来版本档时拒绝写回，返回 false。
 */
export function saveTo(dir: string, data: SaveData, now: number = Date.now()): boolean {
  // 版本比本程序新的档只做内存状态，落一次盘就把新版本写的东西降级覆盖掉了。
  // 连 .bak 都不生成：那条备份是从未认识过的原文件复制的，留着只会误导排查。
  if (data.fromFuture) return false
  mkdirSync(dir, { recursive: true })
  if (existsSync(fileOf(dir))) copyFileSync(fileOf(dir), backupOf(dir))
  writeFileSync(tmpOf(dir), JSON.stringify(toSaveFile({ ...data, lastSeenAt: now }), null, 2), 'utf8')
  renameSync(tmpOf(dir), fileOf(dir))
  return true
}

/** 读档。文件不存在时返回默认值，**不创建文件**。 */
export function loadFrom(dir: string, now: number = Date.now()): SaveData {
  if (!existsSync(fileOf(dir))) return defaultSave(now)
  try {
    return migrate(readJson(fileOf(dir)), now)
  } catch {
    /* 主档坏了往下走备份 */
  }
  if (existsSync(backupOf(dir))) {
    try {
      const fromBackup = migrate(readJson(backupOf(dir)), now)
      return { ...fromBackup, warnings: [...fromBackup.warnings, '主存档无法解析，已回退到上一份备份'] }
    } catch {
      /* 备份也坏，落到默认值 */
    }
  }
  return { ...defaultSave(now), warnings: ['主存档与备份均无法解析，已重置'] }
}
