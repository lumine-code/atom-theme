const path = require("path");

describe("atom-theme", () => {
  afterEach(async () => {
    await lumine.packages.deactivatePackage("atom-day-ui");
    await lumine.packages.deactivatePackage("atom-day-syntax");
    await lumine.packages.deactivatePackage("atom-theme");
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

    const syntaxNames = syntaxPaths.map((stylePath) => path.basename(stylePath));
    expect(syntaxNames).toContain("syntax.lumine-text-editor.css");
    expect(syntaxNames).toContain("variables.css");
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
});
