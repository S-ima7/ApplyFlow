export function AppIconImage({ canvasSize }: { canvasSize: number }) {
  const scale = canvasSize / 512;
  const scaled = (value: number) => value * scale;

  return (
    <div
      style={{
        alignItems: "center",
        background: "#2563eb",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#ffffff",
          borderRadius: scaled(48),
          display: "flex",
          flexDirection: "column",
          gap: scaled(30),
          height: scaled(330),
          justifyContent: "center",
          padding: `${scaled(72)}px ${scaled(58)}px ${scaled(42)}px`,
          position: "relative",
          width: scaled(290)
        }}
      >
        <div
          style={{
            background: "#bfdbfe",
            borderRadius: scaled(22),
            height: scaled(52),
            left: scaled(75),
            position: "absolute",
            top: scaled(42),
            width: scaled(140)
          }}
        />
        {[1, 2, 3].map((line) => (
          <div
            key={line}
            style={{
              background: "#2563eb",
              borderRadius: scaled(10),
              height: scaled(20),
              width: "100%"
            }}
          />
        ))}
      </div>
    </div>
  );
}
