/**
 * 换皮肤这条轴的唯一端到端验证：存档说用哪个皮肤，程序就装载哪个。
 *
 * 覆盖的是 findSkinDir → loadSkin → 协议资源根 → IPC → 渲染层 这一整串接线，
 * 单测只能各自验一段，拼起来对不对只有真跑一次才知道。
 *
 * 跑法：npm run e2e:skin
 */
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BLOCK = 'skins/block'
const SAVE_VERSION = 1

function writeSave(userData, skin) {
  writeFileSync(join(userData, 'save.json'), JSON.stringify({
    version: SAVE_VERSION, skin, stats: { hunger: 80, mind: 80, clean: 80, mood: 80 }, lastSeenAt: 1,
  }, null, 2), 'utf8')
}

/** 造一份用户皮肤：素材沿用占位动画，只改展示名。 */
function makeUserSkin(userData, id, name) {
  const dir = join(userData, 'skins', id)
  const manifest = JSON.parse(readFileSync(join(BLOCK, 'manifest.json'), 'utf8'))
  for (const [pool, names] of Object.entries(manifest.pools)) {
    mkdirSync(join(dir, 'animation', pool), { recursive: true })
    for (const n of names) {
      copyFileSync(join(BLOCK, 'animation', pool, `${n}.webm`), join(dir, 'animation', pool, `${n}.webm`))
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, name }, null, 2), 'utf8')
}

async function run(label, prepare) {
  const userData = mkdtempSync(join(tmpdir(), 'pet-skin-'))
  let app
  try {
    prepare(userData)
    app = await electron.launch({
      args: ['.'],
      cwd: process.cwd(),
      env: { ...process.env, PET_USER_DATA: userData },
    })
    const page = await app.firstWindow()
    const warnings = []
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()) })
    // 只等 __petDebug 出现不够——那只代表装配跑完了，首帧可能还没解码出来，
    // 紧接着断言 videoWidth 就会偶发拿到 0。等前台真的解出画面。
    await page.waitForFunction(
      () => !!window.__petDebug && (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0,
      null,
      { timeout: 30_000 },
    )
    const got = await page.evaluate(() => ({
      skinName: window.__petDebug.skinName,
      src: document.querySelector('video.is-front')?.currentSrc ?? '',
      width: document.querySelector('video.is-front')?.videoWidth ?? 0,
      videos: document.querySelectorAll('video').length,
    }))
    console.log(`\n[${label}]`, JSON.stringify(got))
    return { got, warnings }
  } finally {
    await app?.close().catch(() => {})
    // Windows 上刚退出的进程可能还攥着临时目录里的文件句柄，rmSync 会抛 EBUSY。
    // force 只忽略 ENOENT，所以这里得自己吞掉——留一个没清掉的临时目录，
    // 比把整轮验收弄成失败好得多。
    try {
      rmSync(userData, { recursive: true, force: true })
    } catch {
      /* 清不掉就算了 */
    }
  }
}

// ① 用户目录里的皮肤优先，且存档选的 id 真的被装载
{
  const { got } = await run('用户皮肤生效', (userData) => {
    makeUserSkin(userData, 'mine', '我的宠物')
    writeSave(userData, 'mine')
  })
  assert.equal(got.skinName, '我的宠物', '存档指定了 mine，装载出来的名字却不是它')
  assert.equal(got.videos, 2)
  assert.equal(got.width, 640, '素材没解码成功，协议资源根没指到用户皮肤目录')
  assert.match(got.src, /^app:\/\/skin\/[\w-]+\/[\w-]+\.webm$/)
  console.log('  ok  换皮肤：装载的是用户目录里那份')
}

// ② 存档指向一个不存在的皮肤：回退到内置，但必须留下警告，不许静默
{
  const { got, warnings } = await run('皮肤找不到时回退', (userData) => {
    writeSave(userData, 'nope')
  })
  assert.equal(got.skinName, '色块', '没回退到内置皮肤')
  assert.ok(warnings.some((w) => w.includes('nope')), `没有留下"找不到皮肤"的警告：${warnings.join(' | ')}`)
  console.log('  ok  回退时留了警告，没有静默换皮')
}

// ③ 存档里的 id 想穿越目录：必须被拒
{
  const { got, warnings } = await run('路径穿越的 id 被拒', (userData) => {
    writeSave(userData, '../../etc')
  })
  assert.equal(got.skinName, '色块')
  assert.ok(warnings.some((w) => w.includes('..')), '没有对越界 id 报警')
  console.log('  ok  越界皮肤 id 被挡掉')
}

console.log('\ne2e:skin：3/3 通过')
