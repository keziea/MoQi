import { useEffect, type RefObject } from 'react';

/**
 * 星光粒子动画。
 *
 * 性能要点（之前卡顿的根源）：
 * 1. 用「预渲染光晕 sprite + drawImage」，而不是每帧 createRadialGradient
 *    —— 原来 190 个粒子 × 每帧 1 次渐变创建，每帧要新建近 200 个 CanvasGradient 对象。
 * 2. DPR 上限压到 1.5，减少像素填充量。
 * 3. 粒子数按屏幕面积自适应，不做无用功。
 */
export function useStarField(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  active: boolean,
  opts: { density?: number; colors?: string[] } = {}
) {
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── 预渲染两张光晕贴图（暖金 / 暖白），每帧只做 drawImage ──
    const makeSprite = (r: number, g: number, b: number) => {
      const S = 48;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const cc = c.getContext('2d')!;
      const grd = cc.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grd.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      cc.fillStyle = grd;
      cc.fillRect(0, 0, S, S);
      return c;
    };

    const palette = opts.colors ?? ['214,178,92', '240,208,140', '255,247,228'];
    const sprites = palette.map((rgb) => {
      const [r, g, b] = rgb.split(',').map((n) => Number(n.trim()));
      return makeSprite(r, g, b);
    });

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    interface P {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      life: number;
      decay: number;
      s: number;
      tw: number;
    }

    const base = opts.density ?? 70;
    const count = Math.round(base * Math.min(1.6, Math.max(0.7, (W * H) / (1440 * 900))));

    const spawn = (burst: boolean): P => {
      const angle = rand(0, Math.PI * 2);
      const speed = burst ? rand(2.2, 10) : rand(0.5, 2.4);
      return {
        x: W / 2 + rand(-50, 50),
        y: H * 0.5 + rand(-40, 40),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - rand(1.6, 5),
        r: rand(1.1, 2.6),
        life: 1,
        decay: rand(0.0032, 0.009),
        s: Math.floor(Math.random() * sprites.length),
        tw: rand(0, Math.PI * 2),
      };
    };

    const list: P[] = [];
    for (let i = 0; i < count; i++) list.push(spawn(true));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.vy += 0.05;
        p.vx *= 0.994;
        p.vy *= 0.994;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        p.tw += 0.13;
        if (p.life <= 0) {
          Object.assign(p, spawn(false));
          p.y = H * 0.5 + rand(-40, 40);
        }
        const alpha = Math.max(0, p.life) * (0.5 + 0.5 * Math.sin(p.tw));
        if (alpha <= 0.02) continue;

        const size = p.r * 12;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[p.s], p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => cancelAnimationFrame(raf);
  }, [active, canvasRef, opts.density, opts.colors]);
}
