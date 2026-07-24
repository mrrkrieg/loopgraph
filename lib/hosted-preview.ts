export function isHostedPreview() {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?.replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  return (
    productionUrl === "loopgraph.vercel.app" ||
    process.env.LOOPGRAPH_PREVIEW_CONTENT === "1"
  );
}
