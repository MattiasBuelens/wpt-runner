"use strict";

const { readFile } = require("fs/promises");
const path = require("path");
const { ResourceLoader } = require("jsdom");
const { WindowHandler, AnyHtmlHandler } = require("./serve");
const { filesystemPath } = require("./handlers");

const testharnessPath = path.resolve(__dirname, "../../testharness/testharness.js");
const idlharnessPath = path.resolve(__dirname, "../../testharness/idlharness.js");
const webidl2jsPath = path.resolve(__dirname, "../../testharness/webidl2/lib/webidl2.js");
const gcPath = path.resolve(__dirname, "../../common/gc.js");
const testdriverDummyPath = path.resolve(__dirname, "../testdriver-dummy.js");

exports.ResourceLoader = class extends ResourceLoader {
  constructor(host, testsPath, testsURL) {
    super();
    this.host = host;
    this.testsPath = testsPath;
    this.testsURL = testsURL;
    this.routes = [
      [".window.html", new WindowHandler(testsPath, testsURL)],
      [".any.html", new AnyHtmlHandler(testsPath, testsURL)]
    ];
  }

  fetch(url) {
    const controller = new AbortController();
    const response = {
      statusCode: 0,
      headers: {}
    };
    const promise = this._fetch(url, { signal: controller.signal })
      .then(body => {
        response.statusCode = 200;
        return body;
      }, err => {
        response.statusCode = 500;
        throw err;
      });
    // JSDOM.fromURL() expects these properties on the returned promise
    promise.href = url;
    promise.response = response;
    promise.abort = () => controller.abort(new Error("request canceled by user"));
    promise.getHeader = () => undefined;
    return promise;
  }

  async _fetch(url, { signal } = {}) {
    const { origin, pathname } = new URL(url);
    if (origin !== this.host) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    for (const [pathNameSuffix, handler] of this.routes) {
      if (pathname.endsWith(pathNameSuffix)) {
        return handler.handleRequest(url);
      }
    }

    switch (pathname) {
      case "/resources/testharness.js": {
        return readFile(testharnessPath, { signal });
      }

      case "/resources/idlharness.js": {
        return readFile(idlharnessPath, { signal });
      }

      case "/resources/WebIDLParser.js": {
        return readFile(webidl2jsPath, { signal });
      }

      case "/common/gc.js": {
        return readFile(gcPath, { signal });
      }

      case "/service-workers/service-worker/resources/test-helpers.sub.js": {
        return Buffer.from("window.service_worker_test = () => {};");
      }

      case "/resources/testharnessreport.js": {
        return Buffer.from("window.__setupJSDOMReporter();");
      }

      case "/streams/resources/test-initializer.js": {
        return Buffer.from("window.worker_test = () => {};");
      }

      case "/resources/testharness.css": {
        return Buffer.from("");
      }

      case "/resources/testdriver.js": {
        return readFile(testdriverDummyPath, { signal });
      }

      case "/resources/testdriver-vendor.js": {
        return Buffer.from("");
      }

      default: {
        if (pathname.startsWith(this.testsURL)) {
          const testPath = filesystemPath(this.testsPath, url, this.testsURL);
          try {
            return await readFile(testPath, { signal });
          } catch (e) {
            // File not found
          }
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    }
  }
};
