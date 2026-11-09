import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ---------- palette & type ----------
const C = {
  // light "printed matter" theme: ink = page/background, paper = type
  ink: "#E7E1D3",
  ink2: "#EFEADF",
  line: "#CBC2AE",
  paper: "#1E1C19",
  dim: "#857D6E",
  acid: "#2F4060", // muted navy
  ochre: "#CFA04A",
  hazard: "#A3392B", // oxblood
};
const WIDE = "RocWide, sans-serif";
const COMP = "RocComp, sans-serif";
const MONO = "Krypton, monospace";

// ---------- timeline (frames @ 30fps) ----------
const S = {
  problem: [0, 120],
  statement: [120, 96],
  logo: [216, 96],
  demo: [312, 246],
  features: [558, 150],
  hosts: [708, 66],
  end: [774, 96],
} as const;
export const TOTAL_FRAMES = 870; // 29s

// ---------- helpers ----------
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const lerp = (f: number, a: number, b: number, from = 0, to = 1, e = ease) =>
  interpolate(f, [a, b], [from, to], { ...clamp, easing: e });

const useSpring = (delay = 0, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.6 } });
};

const typed = (text: string, f: number, start: number, cps = 1.4) =>
  text.slice(0, Math.max(0, Math.floor((f - start) * cps)));

const useFonts = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const faces = [
      new FontFace("RocWide", `url(${staticFile("fonts/RocWideBlack.otf")})`),
      new FontFace("RocComp", `url(${staticFile("fonts/RocCompBold.otf")})`),
      new FontFace("Krypton", `url(${staticFile("fonts/KryptonReg.otf")})`, { weight: "400" }),
      new FontFace("Krypton", `url(${staticFile("fonts/KryptonBold.otf")})`, { weight: "700" }),
    ];
    Promise.all(faces.map((f) => f.load())).then((loaded) => {
      loaded.forEach((f) => document.fonts.add(f));
      continueRender(handle);
    });
  }, [handle]);
};

// ---------- shared pieces ----------
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${C.line} 1.4px, transparent 1.4px)`,
          backgroundSize: "36px 36px",
          backgroundPosition: `${frame * 0.25}px ${frame * 0.4}px`,
          opacity: 0.55,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 45%, transparent 0%, #D6CEBC 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.11  0 0 0 0 0.1  0 0 0 0.09 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
          mixBlendMode: "multiply",
        }}
      />
    </AbsoluteFill>
  );
};

const Tag: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({
  children,
  color = C.dim,
  style,
}) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 22,
      letterSpacing: 4,
      textTransform: "uppercase",
      color,
      ...style,
    }}
  >
    {children}
  </div>
);

const Wipe: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [at - 8, at + 8], [-110, 110], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  if (frame < at - 8 || frame > at + 8) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "60%",
          left: `${x + 20}%`,
          background: C.paper,
          transform: "skewX(-12deg)",
        }}
      />
    </AbsoluteFill>
  );
};

const Dots: React.FC<{ n: number; size?: number; color?: string }> = ({ n, size = 18, color = C.paper }) => (
  <span style={{ display: "inline-flex", gap: size * 0.45, alignItems: "center" }}>
    {Array.from({ length: n }).map((_, i) => (
      <span
        key={i}
        style={{ width: size, height: size, borderRadius: size, background: color, display: "inline-block" }}
      />
    ))}
  </span>
);

const Cursor: React.FC<{ color?: string; h?: number }> = ({ color = C.acid, h = 40 }) => {
  const frame = useCurrentFrame();
  return (
    <span
      style={{
        display: "inline-block",
        width: 4,
        height: h,
        background: color,
        marginLeft: 6,
        verticalAlign: "middle",
        opacity: Math.floor(frame / 12) % 2 ? 0 : 1,
      }}
    />
  );
};

// ---------- 1. the problem ----------
const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const ask = "I need your OpenAI API key to deploy.";
  const key = "sk-proj-8fK2vR9tQx4LmZ7wN1aD";
  const keyShown = typed(key, f, 34, 1.3);
  const caught = f >= 70;
  const shake = caught && f < 82 ? Math.sin(f * 3.1) * (82 - f) * 0.9 : 0;
  const leaks = ["model context", "chat transcript", "provider logs"];
  const panelIn = lerp(f, 0, 14);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Tag style={{ position: "absolute", top: 70, left: 90 }}>the old way</Tag>
      <div
        style={{
          width: 1180,
          opacity: panelIn,
          transform: `translateY(${(1 - panelIn) * 40}px)`,
          display: "flex",
          flexDirection: "column",
          gap: 34,
        }}
      >
        <div style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>
          <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim, paddingTop: 22, width: 90 }}>agent</div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 40,
              color: C.paper,
              background: C.ink2,
              border: `2px solid ${C.line}`,
              borderRadius: 22,
              padding: "26px 34px",
            }}
          >
            {typed(ask, f, 6, 2.2)}
            {f < 30 && <Cursor h={36} />}
          </div>
        </div>
        {f >= 30 && (
          <div
            style={{
              display: "flex",
              gap: 22,
              alignItems: "flex-start",
              justifyContent: "flex-end",
              transform: `translateX(${shake}px)`,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 44,
                color: caught ? C.ink : C.paper,
                background: caught ? C.hazard : "#D9D1BF",
                borderRadius: 22,
                padding: "26px 34px",
                position: "relative",
              }}
            >
              {keyShown}
              {!caught && <Cursor color={C.paper} h={40} />}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim, paddingTop: 26, width: 90 }}>you</div>
          </div>
        )}
      </div>

      {caught &&
        leaks.map((label, i) => {
          const p = lerp(f, 78 + i * 6, 98 + i * 6);
          const angle = [-24, 4, 30][i];
          return (
            <div
              key={label}
              style={{
                position: "absolute",
                left: 1380,
                top: 640 + i * 64,
                opacity: p,
                transform: `translate(${p * 140}px, ${Math.sin((angle * Math.PI) / 180) * p * 60}px)`,
                fontFamily: MONO,
                fontSize: 30,
                color: C.hazard,
                whiteSpace: "nowrap",
              }}
            >
              → {label}
            </div>
          );
        })}
      {caught && (
        <div
          style={{
            position: "absolute",
            bottom: 90,
            fontFamily: WIDE,
            fontSize: 54,
            color: C.paper,
            opacity: lerp(f, 88, 100),
            letterSpacing: 1,
          }}
        >
          ...and it's in there <span style={{ color: C.hazard }}>forever.</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ---------- 2. statement ----------
const Statement: React.FC = () => {
  const f = useCurrentFrame();
  const lines = ["YOUR KEYS", "DON'T BELONG", "IN THE CHAT."];
  const bar = lerp(f, 46, 64);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140 }}>
      {lines.map((l, i) => {
        const p = lerp(f, i * 7, i * 7 + 16);
        const isLast = i === 2;
        return (
          <div key={l} style={{ overflow: "hidden", lineHeight: 1.02 }}>
            <div
              style={{
                fontFamily: WIDE,
                fontSize: 148,
                color: isLast ? (bar > 0.55 ? C.paper : C.acid) : C.paper,
                transform: `translateY(${(1 - p) * 110}%)`,
                position: "relative",
                display: "inline-block",
                isolation: "isolate",
              }}
            >
              <span style={{ position: "relative", zIndex: 1 }}>{l}</span>
              {isLast && (
                <div
                  style={{
                    position: "absolute",
                    left: -24,
                    right: -24,
                    top: "2%",
                    height: "96%",
                    background: C.ochre,
                    zIndex: 0,
                    transformOrigin: "left",
                    transform: `scaleX(${bar})`,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
      <Tag color={C.dim} style={{ marginTop: 50, opacity: lerp(f, 58, 72) }}>
        not in context · not in transcripts · not in logs
      </Tag>
    </AbsoluteFill>
  );
};

// ---------- 3. logo ----------
const Wordmark: React.FC<{ size: number; progress?: number }> = ({ size, progress = 1 }) => {
  const word = "SecureInput";
  const reveal = Math.floor(progress * word.length);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
      <div
        style={{
          width: size * 1.05,
          height: size * 1.05,
          borderRadius: size * 0.26,
          background: C.acid,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: size * 0.08,
          transform: `scale(${0.6 + progress * 0.4}) rotate(${(1 - progress) * -30}deg)`,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: size * 0.15, height: size * 0.15, borderRadius: 99, background: C.ink }} />
        ))}
      </div>
      <div style={{ fontFamily: WIDE, fontSize: size, color: C.paper, letterSpacing: -1, whiteSpace: "nowrap" }}>
        {word.split("").map((ch, i) => (
          <span key={i} style={{ color: i < reveal ? (i >= 6 ? C.acid : C.paper) : "transparent", position: "relative" }}>
            {i < reveal ? ch : ch}
            {i >= reveal && (
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: size * 0.2,
                  height: size * 0.2,
                  borderRadius: 99,
                  background: C.dim,
                  transform: "translate(-50%,-50%)",
                }}
              />
            )}
          </span>
        ))}
      </div>
    </div>
  );
};

const Logo: React.FC = () => {
  const f = useCurrentFrame();
  const p = lerp(f, 4, 34, 0, 1, Easing.out(Easing.cubic));
  const sub = lerp(f, 30, 48);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 46 }}>
      <Tag color={C.acid} style={{ opacity: lerp(f, 0, 12) }}>
        introducing
      </Tag>
      <Wordmark size={150} progress={p} />
      <div
        style={{
          fontFamily: MONO,
          fontSize: 40,
          color: C.paper,
          opacity: sub,
          transform: `translateY(${(1 - sub) * 20}px)`,
        }}
      >
        Private API key input for AI coding agents.
      </div>
      <Tag style={{ opacity: lerp(f, 44, 60) }}>open-source · local-first · MCP server</Tag>
    </AbsoluteFill>
  );
};

// ---------- 4. demo ----------
const Node: React.FC<{ title: string; sub: string; on: number; style?: React.CSSProperties; accent?: string }> = ({
  title,
  sub,
  on,
  style,
  accent = C.acid,
}) => (
  <div
    style={{
      position: "absolute",
      width: 640,
      padding: "26px 30px",
      borderRadius: 20,
      background: C.ink2,
      border: `2px solid ${on > 0.5 ? accent : C.line}`,
      boxShadow: on > 0.5 ? "0 14px 30px rgba(30,28,25,0.10)" : "none",
      opacity: interpolate(on, [0, 0.3], [0.25, 1], clamp),
      ...style,
    }}
  >
    <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: C.paper, whiteSpace: "nowrap" }}>{title}</div>
    <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim, marginTop: 10 }}>{sub}</div>
  </div>
);

const Demo: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ask = "I need a GitHub token to create the repo.";
  const formIn = spring({ frame: f - 46, fps, config: { damping: 15, mass: 0.7 } });
  const dotsTyped = Math.min(14, Math.max(0, Math.floor((f - 64) / 2.2)));
  const enter = f >= 100;
  const enterPress = enter && f < 108 ? 0.92 : 1;
  // pellet travel: form -> daemon -> command
  const t1 = lerp(f, 104, 128, 0, 1, Easing.inOut(Easing.cubic));
  const t2 = lerp(f, 132, 156, 0, 1, Easing.inOut(Easing.cubic));
  const daemonOn = lerp(f, 124, 132);
  const cmdOn = lerp(f, 152, 160);
  const resultIn = lerp(f, 166, 184);
  const noteIn = lerp(f, 192, 206);

  // positions in the right-hand diagram
  const formPt = { x: 900, y: 560 };
  const daemonPt = { x: 1160, y: 360 };
  const cmdPt = { x: 1160, y: 680 };
  const px =
    f < 130 ? formPt.x + (daemonPt.x - formPt.x) * t1 : daemonPt.x + (cmdPt.x - daemonPt.x) * t2;
  const py =
    f < 130 ? formPt.y + (daemonPt.y - formPt.y) * t1 : daemonPt.y + (cmdPt.y - daemonPt.y) * t2;
  const pelletVisible = f >= 104 && f < 158;

  return (
    <AbsoluteFill>
      <Tag style={{ position: "absolute", top: 70, left: 90 }} color={C.acid}>
        the secureinput way
      </Tag>
      <Tag style={{ position: "absolute", top: 70, right: 90 }}>illustration</Tag>

      {/* chat panel */}
      <div
        style={{
          position: "absolute",
          left: 90,
          top: 150,
          width: 800,
          height: 840,
          borderRadius: 28,
          background: "rgba(241,236,225,0.92)",
          border: `2px solid ${C.line}`,
          padding: 40,
          display: "flex",
          flexDirection: "column",
          gap: 26,
          opacity: lerp(f, 0, 12),
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {[C.line, C.line, C.line].map((c) => (
            <span key={c} style={{ width: 16, height: 16, borderRadius: 99, background: c, opacity: 0.8 }} />
          ))}
          <span style={{ fontFamily: MONO, fontSize: 20, color: C.dim, marginLeft: 16 }}>coding agent</span>
        </div>

        <div style={{ fontFamily: MONO, fontSize: 32, color: C.paper, lineHeight: 1.35, minHeight: 90 }}>
          {typed(ask, f, 6, 2.4)}
        </div>

        {f >= 30 && (
          <div
            style={{
              alignSelf: "flex-start",
              fontFamily: MONO,
              fontSize: 22,
              color: C.acid,
              border: `1.5px solid ${C.acid}66`,
              borderRadius: 99,
              padding: "8px 18px",
              opacity: lerp(f, 30, 40),
            }}
          >
            ⚙ request_secret
          </div>
        )}

        {/* inline form */}
        <div
          style={{
            borderRadius: 20,
            border: `2px solid ${enter ? C.acid : "#BBB19B"}`,
            background: C.ink,
            padding: "24px 28px",
            transform: `scale(${(0.9 + formIn * 0.1) * enterPress})`,
            transformOrigin: "left top",
            opacity: formIn,
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 24, color: C.dim }}>GitHub token</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, height: 44 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {!enter && <Dots n={dotsTyped} size={16} />}
              {!enter && <Cursor h={34} />}
              {enter && (
                <span style={{ fontFamily: MONO, fontSize: 24, color: C.acid }}>✓ sent outside the chat</span>
              )}
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 22,
                color: enter ? C.ink : C.paper,
                background: enter ? C.acid : "#D9D1BF",
                padding: "6px 16px",
                borderRadius: 10,
              }}
            >
              ↵ Enter
            </div>
          </div>
        </div>

        {/* result */}
        <div
          style={{
            opacity: resultIn,
            transform: `translateY(${(1 - resultIn) * 24}px)`,
            fontFamily: MONO,
            fontSize: 26,
            lineHeight: 1.5,
            background: "#E2DBCB",
            border: `1.5px dashed ${C.line}`,
            borderRadius: 16,
            padding: "20px 26px",
            color: C.paper,
          }}
        >
          <div style={{ color: C.dim, fontSize: 20, marginBottom: 6 }}>tool result → agent</div>
          {"{ "}
          <span style={{ color: C.acid }}>"ok"</span>: true, <span style={{ color: C.acid }}>"status"</span>:{" "}
          "completed",
          <br />
          {"  "}
          <span style={{ color: C.acid }}>"exitCode"</span>: 0 {" }"}
        </div>
        <div
          style={{
            opacity: noteIn,
            fontFamily: WIDE,
            fontSize: 36,
            color: C.paper,
          }}
        >
          The agent gets the <span style={{ color: C.acid }}>status</span>.<br />
          Never the key.
        </div>
      </div>

      {/* diagram */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <path
          d={`M ${formPt.x} ${formPt.y} C 1060 ${formPt.y}, 1060 ${daemonPt.y}, ${daemonPt.x} ${daemonPt.y}`}
          stroke={daemonOn > 0 ? C.acid : C.line}
          strokeWidth={3}
          fill="none"
          strokeDasharray="10 10"
          strokeDashoffset={-f * 1.5}
          opacity={lerp(f, 40, 60)}
        />
        <path
          d={`M ${daemonPt.x + 60} ${daemonPt.y + 60} L ${cmdPt.x + 60} ${cmdPt.y - 60}`}
          stroke={cmdOn > 0 ? C.acid : C.line}
          strokeWidth={3}
          fill="none"
          strokeDasharray="10 10"
          strokeDashoffset={-f * 1.5}
          opacity={lerp(f, 40, 60)}
        />
      </svg>
      {pelletVisible && (
        <div
          style={{
            position: "absolute",
            left: px - 22,
            top: py - 22,
            width: 44,
            height: 44,
            borderRadius: 99,
            background: C.acid,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 9, background: C.ink }} />
        </div>
      )}
      <Node
        title="SecureInput daemon"
        sub="listening on 127.0.0.1 only"
        on={Math.max(daemonOn, lerp(f, 40, 56) * 0.3)}
        style={{ left: daemonPt.x, top: daemonPt.y - 60 }}
      />
      <Node
        title="$ gh auth login --with-token"
        sub="token piped through stdin · no shell, no argv"
        on={Math.max(cmdOn, lerp(f, 46, 62) * 0.3)}
        style={{ left: cmdPt.x, top: cmdPt.y - 60 }}
      />
      <div
        style={{
          position: "absolute",
          left: cmdPt.x,
          top: cmdPt.y + 120,
          fontFamily: MONO,
          fontSize: 22,
          color: C.dim,
          opacity: lerp(f, 160, 175),
        }}
      >
        or → write_env: .env.local <span style={{ color: C.acid }}>(mode 0600)</span>
      </div>
    </AbsoluteFill>
  );
};

// ---------- 5. features ----------
const FEATURES: [string, string][] = [
  ["127.0.0.1 ONLY", "pairing token · signed cookie · origin + CSRF checks"],
  ["STDIN, NEVER ARGV", "no shell · nothing in ps or shell history"],
  [".ENV AT 0600", "atomic writes · comments and line endings kept"],
  ["ONE-TIME REQUESTS", "short expiry · each submission claimed once"],
  ["STATUS, NOT SECRETS", "output redacted · audit log without values"],
];

const Features: React.FC = () => {
  const f = useCurrentFrame();
  const step = 28;
  const active = Math.min(FEATURES.length - 1, Math.floor(f / step));
  const scroll = interpolate(f, FEATURES.map((_, i) => i * step), FEATURES.map((_, i) => i), {
    ...clamp,
  });
  const smooth = Math.floor(scroll) + ease(scroll % 1 > 0 ? Math.min(1, (scroll % 1) * 2.2) : 0);
  return (
    <AbsoluteFill>
      <Tag style={{ position: "absolute", top: 70, left: 90 }} color={C.acid}>
        built paranoid
      </Tag>
      <AbsoluteFill
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0%, transparent 16%, black 34%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, transparent 16%, black 34%)",
        }}
      >
      <div style={{ position: "absolute", left: 140, top: 430, transform: `translateY(${-smooth * 150}px)` }}>
        {FEATURES.map(([big, small], i) => {
          const isActive = i === active;
          const appear = lerp(f, i * step - 6, i * step + 6);
          return (
            <div key={big} style={{ height: 150, opacity: appear * (isActive ? 1 : 0.18) }}>
              <div
                style={{
                  fontFamily: COMP,
                  fontSize: 120,
                  lineHeight: 1,
                  color: isActive ? C.acid : C.paper,
                  letterSpacing: 2,
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 30, color: C.dim, marginRight: 30, verticalAlign: "top" }}>
                  0{i + 1}
                </span>
                {big}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 26,
                  color: C.paper,
                  marginLeft: 82,
                  marginTop: 6,
                  opacity: isActive ? lerp(f, i * step + 4, i * step + 12) : 0,
                }}
              >
                {small}
              </div>
            </div>
          );
        })}
      </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------- 6. hosts ----------
const HOSTS = ["Claude Code", "Cursor", "Codex", "VS Code + Copilot", "Windsurf", "Cline"];
const Hosts: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 60 }}>
      <div style={{ fontFamily: WIDE, fontSize: 84, color: C.paper, opacity: lerp(f, 0, 10) }}>
        Works with your agent.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, justifyContent: "center", width: 1500 }}>
        {HOSTS.map((h, i) => {
          const s = spring({ frame: f - 6 - i * 4, fps, config: { damping: 12, mass: 0.5 } });
          return (
            <div
              key={h}
              style={{
                fontFamily: MONO,
                fontSize: 34,
                color: C.paper,
                border: `2px solid ${C.line}`,
                background: C.ink2,
                borderRadius: 99,
                padding: "16px 34px",
                transform: `scale(${s}) translateY(${(1 - s) * 30}px)`,
                opacity: s,
              }}
            >
              {h}
            </div>
          );
        })}
      </div>
      <Tag style={{ opacity: lerp(f, 30, 44) }}>any stdio MCP client · inline form or paired localhost browser</Tag>
    </AbsoluteFill>
  );
};

// ---------- 7. end card ----------
const End: React.FC = () => {
  const f = useCurrentFrame();
  const a = lerp(f, 0, 20);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 50 }}>
      <div style={{ transform: `scale(${0.92 + a * 0.08})`, opacity: a }}>
        <Wordmark size={130} progress={lerp(f, 0, 24)} />
      </div>
      <div style={{ fontFamily: WIDE, fontSize: 52, color: C.paper, opacity: lerp(f, 18, 34), textAlign: "center" }}>
        Give your agent access. <span style={{ color: C.acid }}>Not your keys.</span>
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 36,
          color: C.ink,
          background: C.acid,
          padding: "16px 34px",
          borderRadius: 14,
          opacity: lerp(f, 32, 46),
          transform: `translateY(${(1 - lerp(f, 32, 46)) * 20}px)`,
        }}
      >
        github.com/r69shabh/secureinput
      </div>
      <Tag style={{ opacity: lerp(f, 42, 56) }}>open source · MIT · macOS + Linux · Node 22+</Tag>
    </AbsoluteFill>
  );
};

// ---------- composition ----------
const Scene: React.FC<{ at: readonly [number, number]; children: React.ReactNode }> = ({ at, children }) => (
  <Sequence from={at[0]} durationInFrames={at[1]}>
    {children}
  </Sequence>
);

export const Launch: React.FC = () => {
  useFonts();
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [TOTAL_FRAMES - 14, TOTAL_FRAMES - 1], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      {/* original soundtrack, generated by scripts/compose.py */}
      <Audio src={staticFile("music.wav")} />
      <Backdrop />
      <AbsoluteFill style={{ opacity: fadeOut }}>
        <Scene at={S.problem}>
          <Problem />
        </Scene>
        <Scene at={S.statement}>
          <Statement />
        </Scene>
        <Scene at={S.logo}>
          <Logo />
        </Scene>
        <Scene at={S.demo}>
          <Demo />
        </Scene>
        <Scene at={S.features}>
          <Features />
        </Scene>
        <Scene at={S.hosts}>
          <Hosts />
        </Scene>
        <Scene at={S.end}>
          <End />
        </Scene>
      </AbsoluteFill>
      {[S.statement, S.logo, S.demo, S.features, S.hosts, S.end].map((s) => (
        <Wipe key={s[0]} at={s[0]} />
      ))}
    </AbsoluteFill>
  );
};
