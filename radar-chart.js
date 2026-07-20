(() => {
  const axes = [
    { key: "accent", label: "重音" },
    { key: "intonation", label: "語調" },
    { key: "speed", label: "語速" },
    { key: "volume", label: "音量" },
  ];

  function scoreFor(values, axis) {
    const aliases = {
      accent: ["accent", "重音"],
      intonation: ["intonation", "語調"],
      speed: ["speed", "語速", "節奏長度"],
      volume: ["volume", "音量", "錄音品質"],
    };
    const key = aliases[axis.key].find((name) => values?.[name] !== undefined);
    return Math.max(0, Math.min(100, Number(key ? values[key] : 0) || 0));
  }

  function point(centerX, centerY, radius, index, value = 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
    return {
      x: centerX + Math.cos(angle) * radius * value,
      y: centerY + Math.sin(angle) * radius * value,
    };
  }

  function polygon(context, points) {
    context.beginPath();
    points.forEach((item, index) => {
      if (index) context.lineTo(item.x, item.y);
      else context.moveTo(item.x, item.y);
    });
    context.closePath();
  }

  function drawPracticeRadar(canvas, values = {}) {
    if (!canvas) return;
    canvas.__practiceRadarValues = values;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(240, Math.round(bounds.width || 300));
    const height = Math.max(220, Math.round(bounds.height || width * 0.86));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2 - 4;
    const radius = Math.max(58, Math.min(width * 0.31, height * 0.31));

    [0.25, 0.5, 0.75, 1].forEach((level) => {
      polygon(context, axes.map((axis, index) => point(centerX, centerY, radius, index, level)));
      context.strokeStyle = level === 1 ? "#b9c8c2" : "#dce4e1";
      context.lineWidth = level === 1 ? 1.5 : 1;
      context.stroke();
    });

    axes.forEach((axis, index) => {
      const end = point(centerX, centerY, radius, index);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(end.x, end.y);
      context.strokeStyle = "#d1dbd7";
      context.lineWidth = 1;
      context.stroke();
    });

    const scores = axes.map((axis) => scoreFor(values, axis));
    const scorePoints = scores.map((score, index) => point(centerX, centerY, radius, index, score / 100));
    polygon(context, scorePoints);
    context.fillStyle = "rgba(31, 106, 90, 0.22)";
    context.fill();
    context.strokeStyle = "#1f6a5a";
    context.lineWidth = 3;
    context.stroke();

    scorePoints.forEach((item) => {
      context.beginPath();
      context.arc(item.x, item.y, 4.5, 0, Math.PI * 2);
      context.fillStyle = "#e7b65c";
      context.fill();
      context.strokeStyle = "#123b36";
      context.lineWidth = 1.5;
      context.stroke();
    });

    context.font = '700 14px "Noto Sans TC", "PingFang TC", sans-serif';
    context.fillStyle = "#263b35";
    axes.forEach((axis, index) => {
      const labelPoint = point(centerX, centerY, radius + 22, index);
      context.textAlign = index === 1 ? "left" : index === 3 ? "right" : "center";
      context.textBaseline = index === 0 ? "bottom" : index === 2 ? "top" : "middle";
      context.fillText(`${axis.label} ${Math.round(scores[index])}`, labelPoint.x, labelPoint.y);
    });
    canvas.setAttribute("aria-label", axes.map((axis, index) => `${axis.label} ${Math.round(scores[index])} 分`).join("、"));
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll("canvas.practice-radar").forEach((canvas) => {
        if (canvas.__practiceRadarValues) drawPracticeRadar(canvas, canvas.__practiceRadarValues);
      });
    }, 120);
  });

  window.drawPracticeRadar = drawPracticeRadar;
})();
