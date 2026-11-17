const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chart: "M4 19V5m0 14h16M8 15v-4m4 4V7m4 8v-6",
  search: "m20 20-4.5-4.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8m-8 4h5",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  desktop: "M4 4h16a1 1 0 0 1 1 1v11H3V5a1 1 0 0 1 1-1Zm4 16h8m-4-4v4",
  check: "m5 12 4 4L19 6",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6",
  play: "m9 5 11 7-11 7V5Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m6 9 6 6 6-6",
  briefcase: "M8 7V4h8v3M3 7h18v13H3V7Zm0 5 9 3 9-3m-9 1v4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  help: "M9.5 9a2.5 2.5 0 1 1 4 2c-1 .8-1.5 1-1.5 3m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
};

export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
