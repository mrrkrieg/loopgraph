const githubUrl = "https://github.com/mrrkrieg/loopgraph";

export function PreviewGithubBanner() {
  return (
    <aside className="preview-github-banner" aria-label="Loopgraph open source repository">
      <span className="preview-github-banner__message">
        <span className="preview-github-banner__mark" aria-hidden="true" />
        Loopgraph is open source
      </span>
      <a
        className="preview-github-banner__link"
        href={githubUrl}
        rel="noreferrer"
        target="_blank"
      >
        Review the build on GitHub
        <ExternalArrowIcon />
      </a>
    </aside>
  );
}

function ExternalArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M5 11 11 5M6 5h5v5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
