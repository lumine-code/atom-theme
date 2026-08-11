const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const stylesRoot = path.join(packageRoot, "styles");

function customPropertiesIn(filePath, { before } = {}) {
  let source = fs.readFileSync(filePath, "utf8");
  if (before) source = source.split(before, 1)[0];
  return [...source.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((match) => match[1]).sort();
}

function cssFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFilesUnder(entryPath);
    return entry.name.endsWith(".css") ? [entryPath] : [];
  });
}

function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((channel) => Number(channel) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("atom-theme", () => {
  afterEach(async () => {
    document.querySelectorAll("[data-atom-theme-spec]").forEach((element) => element.remove());

    for (const packageName of [
      "atom-day-ui",
      "atom-day-syntax",
      "atom-night-ui",
      "atom-night-syntax",
      "atom-theme",
    ]) {
      await lumine.packages.deactivatePackage(packageName);
    }
  });

  it("registers its light and dark themes as a pack", async () => {
    await lumine.packages.activatePackage("atom-theme");

    const themePack = lumine.themes.getThemePacks().find(({ name }) => name === "Atom");

    expect(themePack.light).toEqual(["atom-day-ui", "atom-day-syntax"]);
    expect(themePack.dark).toEqual(["atom-night-ui", "atom-night-syntax"]);
  });

  it("loads a self-contained style layer, palette last", async () => {
    await lumine.packages.activatePackage("atom-theme");

    const uiPaths = lumine.packages.getLoadedPackage("atom-day-ui").getStylesheetPaths();
    const syntaxPaths = lumine.packages.getLoadedPackage("atom-day-syntax").getStylesheetPaths();

    // Nothing is inherited from another theme package.
    for (const stylePath of [...uiPaths, ...syntaxPaths]) {
      expect(stylePath).toContain(`${path.sep}atom-theme${path.sep}`);
    }

    const uiNames = uiPaths.map((stylePath) => path.basename(stylePath));
    expect(uiNames).toContain("15-tabs.css");
    expect(uiNames.indexOf("15-tabs.css")).toBeLessThan(uiNames.indexOf("variables.css"));

    // The rules split across numbered files and load in name order; the palette
    // is last, and no file spells the editor scope in its name — a syntax
    // theme's stylesheets get that context from the theme's own type.
    const syntaxNames = syntaxPaths.map((stylePath) => path.basename(stylePath));
    expect(syntaxNames).toContain("01-editor.css");
    expect(syntaxNames).toContain("03-base.css");
    expect(syntaxNames).toContain("variables.css");
    expect(syntaxNames.filter((name) => name.includes(".lumine-text-editor."))).toEqual([]);
    expect(syntaxNames).toEqual([...syntaxNames].sort());
  });

  it("applies its stylesheets once the themes activate", async () => {
    await lumine.packages.activatePackage("atom-theme");
    await lumine.packages.activatePackage("atom-day-ui");
    await lumine.packages.activatePackage("atom-day-syntax");

    const tabsPath = lumine.packages
      .getLoadedPackage("atom-day-ui")
      .getStylesheetPaths()
      .find((stylePath) => path.basename(stylePath) === "15-tabs.css");

    expect(lumine.themes.stylesheetElementForId(tabsPath)).not.toBeNull();
  });

  it("keeps the day and night variable contracts in sync", () => {
    const uiDay = customPropertiesIn(path.join(stylesRoot, "day-ui", "variables.css"));
    const uiNight = customPropertiesIn(path.join(stylesRoot, "night-ui", "variables.css"));
    expect(uiDay).toEqual(uiNight);

    // Syntax themes have deliberately different private classic palettes, but
    // everything before that section is the public theme contract.
    const options = { before: "/* --- theme-local token palette" };
    const syntaxDay = customPropertiesIn(
      path.join(stylesRoot, "day-syntax", "variables.css"),
      options,
    );
    const syntaxNight = customPropertiesIn(
      path.join(stylesRoot, "night-syntax", "variables.css"),
      options,
    );
    expect(syntaxDay).toEqual(syntaxNight);
  });

  it("declares every custom property referenced by its styles", () => {
    const uiFiles = cssFilesUnder(path.join(stylesRoot, "ui"));
    const bundles = [
      [...uiFiles, path.join(stylesRoot, "day-ui", "variables.css")],
      [...uiFiles, path.join(stylesRoot, "night-ui", "variables.css")],
      cssFilesUnder(path.join(stylesRoot, "day-syntax")),
      cssFilesUnder(path.join(stylesRoot, "night-syntax")),
    ];

    for (const files of bundles) {
      const declarations = new Set(files.flatMap((filePath) => customPropertiesIn(filePath)));
      const references = new Set(
        files.flatMap((filePath) => {
          const source = fs.readFileSync(filePath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
          return [...source.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((match) => match[1]);
        }),
      );

      expect([...references].filter((name) => !declarations.has(name)).sort()).toEqual([]);
    }
  });

  it("uses readable colors for active navigation and selected list details", async () => {
    await lumine.packages.activatePackage("atom-theme");
    await lumine.packages.activatePackage("atom-day-ui");

    const fixture = document.createElement("div");
    fixture.innerHTML = `
      <ul class="nav-tabs"><li class="active"><a>Active</a></li></ul>
      <div class="select-list"><ol class="list-group">
        <li class="two-lines selected"><span class="secondary-line">Details</span></li>
      </ol></div>
      <div class="tab-bar"></div><div class="item-views"></div>
    `;
    fixture.dataset.atomThemeSpec = "";
    document.body.appendChild(fixture);

    const resolvedColor = (propertyName) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${propertyName})`;
      fixture.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const activeLink = fixture.querySelector(".nav-tabs a");
    const details = fixture.querySelector(".secondary-line");
    const itemViews = fixture.querySelector(".item-views");

    expect(getComputedStyle(activeLink).color).toBe(resolvedColor("--text-color-highlight"));
    expect(getComputedStyle(details).color).toBe(resolvedColor("--text-color-selected"));
    expect(getComputedStyle(itemViews, "::before").height).toBe("5px");

    fixture.remove();
  });

  it("keeps paired foreground and background tokens readable in both palettes", async () => {
    await lumine.packages.activatePackage("atom-theme");

    for (const themeName of ["atom-day-ui", "atom-night-ui"]) {
      await lumine.packages.activatePackage(themeName);

      const fixture = document.createElement("div");
      fixture.dataset.atomThemeSpec = "";
      fixture.className = "overlay select-list";
      fixture.innerHTML = '<div class="empty-message">No language servers are running</div>';
      document.body.appendChild(fixture);

      const messageColor = getComputedStyle(fixture.firstElementChild).color;
      const surfaceColor = getComputedStyle(fixture).backgroundColor;
      expect(contrastRatio(messageColor, surfaceColor)).toBeGreaterThanOrEqual(4.5);

      const pairs = [
        ["--text-color", "--button-background-color"],
        ["--text-color-subtle", "--base-background-color"],
        ["--text-color-subtle", "--overlay-background-color"],
        ["--text-color-hint", "--base-background-color"],
        ["--text-color-ignored", "--base-background-color"],
        ["--text-color-info", "--overlay-background-color"],
        ["--text-color-success", "--overlay-background-color"],
        ["--text-color-warning", "--overlay-background-color"],
        ["--text-color-error", "--overlay-background-color"],
        ["--text-color-selected", "--background-color-selected"],
        ["--button-text-color-selected", "--button-background-color-selected"],
        ["--accent-text-color", "--accent-color"],
        ["--accent-bg-text-color", "--accent-bg-color"],
        ["--text-color-on-info", "--background-color-info"],
        ["--text-color-on-success", "--background-color-success"],
        ["--text-color-on-warning", "--background-color-warning"],
        ["--text-color-on-error", "--background-color-error"],
      ];

      for (const [foreground, background] of pairs) {
        const probe = document.createElement("span");
        probe.style.color = `var(${foreground})`;
        probe.style.backgroundColor = `var(${background})`;
        fixture.appendChild(probe);

        const style = getComputedStyle(probe);
        expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
        probe.remove();
      }

      for (const variant of ["info", "success", "warning", "error"]) {
        const badge = document.createElement("span");
        badge.className = `badge badge-${variant}`;
        badge.textContent = variant;
        fixture.appendChild(badge);

        const style = getComputedStyle(badge);
        expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
        badge.remove();

        for (const state of ["", "focus", "active", "selected"]) {
          const button = document.createElement("button");
          button.className = `btn btn-${variant} ${state}`;
          fixture.appendChild(button);

          const style = getComputedStyle(button);
          const stops = style.backgroundImage.match(/rgba?\([^)]*\)/g) || [];
          expect(stops.length).toBeGreaterThan(0);
          for (const stop of stops) {
            expect(contrastRatio(style.color, stop)).toBeGreaterThanOrEqual(4.5);
          }

          button.remove();
        }
      }

      fixture.remove();
      await lumine.packages.deactivatePackage(themeName);
    }
  });

  it("keeps syntax contract colors readable in both palettes", async () => {
    await lumine.packages.activatePackage("atom-theme");

    const foregrounds = [
      "--syntax-text-color",
      "--syntax-color-added",
      "--syntax-color-modified",
      "--syntax-color-removed",
      "--syntax-color-renamed",
      "--syntax-color-variable",
      "--syntax-color-constant",
      "--syntax-color-property",
      "--syntax-color-value",
      "--syntax-color-function",
      "--syntax-color-method",
      "--syntax-color-class",
      "--syntax-color-keyword",
      "--syntax-color-tag",
      "--syntax-color-attribute",
      "--syntax-color-import",
      "--syntax-color-snippet",
      "--syntax-color-string",
      "--syntax-color-comment",
    ];

    for (const themeName of ["atom-day-syntax", "atom-night-syntax"]) {
      await lumine.packages.activatePackage(themeName);

      const fixture = document.createElement("div");
      fixture.dataset.atomThemeSpec = "";
      fixture.style.backgroundColor = "var(--syntax-background-color)";
      document.body.appendChild(fixture);

      for (const foreground of foregrounds) {
        const probe = document.createElement("span");
        probe.style.color = `var(${foreground})`;
        fixture.appendChild(probe);

        const style = getComputedStyle(probe);
        const background = getComputedStyle(fixture).backgroundColor;
        expect(contrastRatio(style.color, background)).toBeGreaterThanOrEqual(4.5);
        probe.remove();
      }

      fixture.remove();
      await lumine.packages.deactivatePackage(themeName);
    }
  });

  it("keeps class-based and disabled button states consistent", async () => {
    await lumine.packages.activatePackage("atom-theme");
    await lumine.packages.activatePackage("atom-day-ui");

    const fixture = document.createElement("div");
    fixture.dataset.atomThemeSpec = "";
    fixture.innerHTML = `
      <button class="btn resting">Resting</button>
      <button class="btn active pressed">Pressed</button>
      <button class="btn active disabled disabled-pressed">Disabled</button>
      <button class="btn selected selected-resting">Selected</button>
      <button class="btn selected active disabled selected-disabled">Selected disabled</button>
      <button class="btn btn-success semantic-resting">Success</button>
      <button class="btn btn-success active disabled semantic-disabled">Disabled success</button>
      <div class="panel-heading">
        <button class="btn panel-resting">Panel</button>
        <button class="btn active disabled panel-disabled">Disabled panel</button>
        <button class="btn btn-success panel-semantic">Panel success</button>
      </div>
    `;
    document.body.appendChild(fixture);

    const backgroundImage = (selector) =>
      getComputedStyle(fixture.querySelector(selector)).backgroundImage;

    expect(backgroundImage(".pressed")).not.toBe(backgroundImage(".resting"));
    expect(backgroundImage(".disabled-pressed")).toBe(backgroundImage(".resting"));
    expect(backgroundImage(".selected-disabled")).toBe(backgroundImage(".selected-resting"));
    expect(backgroundImage(".semantic-disabled")).toBe(backgroundImage(".semantic-resting"));
    expect(backgroundImage(".panel-disabled")).toBe(backgroundImage(".panel-resting"));
    expect(backgroundImage(".panel-semantic")).toBe(backgroundImage(".semantic-resting"));

    fixture.remove();
  });
});
