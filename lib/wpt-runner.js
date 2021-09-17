"use strict";

const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const recursiveReaddirCb = require("recursive-readdir");
const consoleReporter = require("./console-reporter.js");
const { setupServer } = require("./server.js");
const { SourceFile } = require("./internal/sourcefile.js");

module.exports = (testsPath, {
  rootURL = "/",
  setup = () => {},
  filter = () => true,
  reporter = consoleReporter
} = {}) => {
  if (!rootURL.startsWith("/")) {
    rootURL = "/" + rootURL;
  }
  if (!rootURL.endsWith("/")) {
    rootURL += "/";
  }

  const server = setupServer(testsPath, { rootURL });
  const urlPrefix = `http://127.0.0.1:${server.address().port}${rootURL}`;

  server.unref();

  return readTestPaths(testsPath).then(testPaths => {
    let totalFailures = 0;
    return doTest(0).then(() => totalFailures);

    function doTest(index) {
      if (index >= testPaths.length) {
        return undefined;
      }

      const testPath = testPaths[index];
      const url = urlPrefix + testPath;

      return Promise.resolve(filter(testPath, url)).then(result => {
        if (result) {
          reporter.startSuite(testPath);
          return runTest(url, setup, reporter).then(success => {
            if (!success) {
              ++totalFailures;
            }
          });
        }

        return undefined;
      }).then(() => doTest(index + 1));
    }
  });
};

function runTest(url, setup, reporter) {
  return new Promise(resolve => {
    const virtualConsole = new VirtualConsole()
      .sendTo(console, { omitJSDOMErrors: true })
      .on("jsdomError", e => {
        // eslint-disable-function no-console

        // Especially for a test runner, we want to surface unhandled exception stacks very directly.
        if (e.type === "unhandled exception") {
          console.error(e.detail.stack || e.detail);
        } else {
          console.error(e.stack, e.detail.stack || e.detail);
        }
      });

    JSDOM.fromURL(url, {
      resources: "usable",
      runScripts: "dangerously",
      virtualConsole
    }).then(dom => {
      let hasFailed = false;
      const { window } = dom;

      // jsdom does not have worker support; make the tests silently skip that
      window.Worker = class {};
      window.SharedWorker = class {};

      setup(window);

      /* eslint-disable no-underscore-dangle */
      window.__setupJSDOMReporter = () => {
        /* eslint-enable no-underscore-dangle */
        // jsdom does not have worker support; make the tests silently skip that

        /* eslint-disable camelcase */
        window.fetch_tests_from_worker = () => {};
        /* eslint-enable camelcase */

        window.add_result_callback(test => {
          if (test.status === 0) {
            reporter.pass(test.name);
          } else if (test.status === 1) {
            reporter.fail(`${test.name}\n`);
            reporter.reportStack(`${test.message}\n${test.stack}`);
            hasFailed = true;
          } else if (test.status === 2) {
            reporter.fail(`${test.name} (timeout)\n`);
            reporter.reportStack(`${test.message}\n${test.stack}`);
            hasFailed = true;
          } else if (test.status === 3) {
            reporter.fail(`${test.name} (incomplete)\n`);
            reporter.reportStack(`${test.message}\n${test.stack}`);
            hasFailed = true;
          } else if (test.status === 4) {
            reporter.fail(`${test.name} (precondition failed)\n`);
            reporter.reportStack(`${test.message}\n${test.stack}`);
            hasFailed = true;
          } else {
            reporter.fail(`unknown test status: ${test.status}`);
            hasFailed = true;
          }
        });

        window.add_completion_callback((tests, harnessStatus) => {
          if (harnessStatus.status === 0) {
            resolve(!hasFailed);
          } else if (harnessStatus.status === 1) {
            reporter.fail("test harness threw unexpected error");
            reporter.reportStack(`${harnessStatus.message}\n${harnessStatus.stack}`);
            resolve(false);
          } else if (harnessStatus.status === 2) {
            reporter.fail("test harness should not timeout");
            resolve(false);
          } else if (harnessStatus.status === 4) {
            reporter.fail("test harness precondition failed");
            reporter.reportStack(`${harnessStatus.message}\n${harnessStatus.stack}`);
            resolve(false);
          } else {
            reporter.fail(`unknown test harness status: ${harnessStatus.status}`);
            resolve(false);
          }

          window.close();
        });
      };
    }).catch(err => {
      reporter.reportStack(err.stack);
      resolve(false);
    });
  });
}

function readTestPaths(testsPath) {
  return recursiveReaddir(testsPath).then(fileNames => {
    const testFilePaths = [];
    for (const fileName of fileNames) {
      const sourceFile = new SourceFile(testsPath, path.relative(testsPath, fileName));
      testFilePaths.push(...sourceFile.testPaths());
    }
    return testFilePaths.sort();
  });
}

function recursiveReaddir(dirPath) {
  return new Promise((resolve, reject) => {
    recursiveReaddirCb(dirPath, (err, results) => {
      if (err) {
        reject(err);
      }
      resolve(results);
    });
  });
}

