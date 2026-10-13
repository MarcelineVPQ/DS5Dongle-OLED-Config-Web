// Stands in for the `electron` package in tests (vitest.config.ts aliases it
// here). Outside the Electron runtime the package exports only the path to
// its binary, and on first import it downloads and unpacks that binary.
// Several test workers importing it at once unpacked it over each other
// ("The file exists. (os error 80)" on the Windows runner) and the disk work
// slowed the tests running beside them past their timeout. No test needs the
// binary: the main-process modules only read Electron's APIs when called.
export default "electron";
