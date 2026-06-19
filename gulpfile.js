const { src, dest } = require('gulp');

// Copy SVG and PNG node icons from `nodes/**/*` into `dist/nodes/**/*`. The
// TypeScript compiler doesn't copy non-TS files, and n8n needs the icons
// to live next to the compiled .node.js for the UI to render them.
function buildIcons() {
  const nodeSource = ['nodes/**/*.{png,svg}'];
  const nodeDestination = './dist/nodes';

  const credSource = ['credentials/**/*.{png,svg}'];
  const credDestination = './dist/credentials';

  return src(nodeSource)
    .pipe(dest(nodeDestination))
    .on('end', () => {
      src(credSource).pipe(dest(credDestination));
    });
}

exports['build:icons'] = buildIcons;
