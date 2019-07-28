var fs = require('fs'),
    path = require('path'),
    _ = require('lodash'),
    handlebars = require('handlebars'),
    helpers = require('handlebars-helpers')({
        handlebars: handlebars
    }),

    util = require('./util'),
    FILE_READ_OPTIONS = { encoding: 'utf8' },
    DEFAULT_TEMPLATE = 'dashboard-template.hbs',
    DARK_THEME = 'dark-theme-dashboard.hbs',
    AGGREGATED_FIELDS = ['cursor', 'item', 'request', 'response', 'requestError'],
    PostmanHTMLExtraSenderReport;

    PostmanHTMLExtraSenderReport = function (newman, options, collectionRunOptions, report) {
        handlebars.registerHelper('percent', function (passed, failed) {
            return (passed * 100 / (passed + failed)).toFixed(0);
        });
        handlebars.registerHelper('formdata', function (context) {
            let formdata = {};
    
            context.forEach(function (value, key) {
                if (value.src) {
                    formdata[value.key] = value.src;
                }
                else {
                    formdata[value.key] = value.value;
                }
            });
    
            return JSON.stringify(formdata);
        });
        handlebars.registerHelper('inc', function (value) {
            return parseInt(value) + 1;
        });
        handlebars.registerHelper('totalTests', function (assertions, skippedTests) {
            return skippedTests ? parseInt(assertions) - parseInt(skippedTests) : parseInt(assertions);
        });
        handlebars.registerHelper('moment', require('helper-moment'));
        handlebars.registerHelper('browserTitle', function () {
            var browserTitle = options.browserTitle || 'Newman Summary Report';
    
            return browserTitle;
        });
        handlebars.registerHelper('title', function () {
            var title = options.title || 'Newman Run Dashboard';
    
            return title;
        });
        handlebars.registerHelper('titleSize', function () {
            var titleSize = options.titleSize || 2;
    
            return titleSize;
        });
        handlebars.registerHelper('paging', function () {
            var paging = options.testPaging || false;
    
            return paging;
        });
        handlebars.registerHelper('logs', function () {
            var logs = options.logs || false;
    
            return logs;
        });
        handlebars.registerHelper('isTheSame', function (lvalue, rvalue, options) {
            if (arguments.length < 3) {
                throw new Error('Handlebars Helper equal needs 2 parameters');
            }
            if (lvalue !== rvalue) {
                return options.inverse(this);
            }
            else {
                return options.fn(this);
            }
        });
    
        if (options.darkTheme && !options.template && !options.showOnlyFails) {
            var htmlTemplate = path.join(__dirname, DARK_THEME);
        }
        else if (options.showOnlyFails && !options.template && !options.darkTheme) {
            var htmlTemplate = path.join(__dirname, SHOW_ONLY_FAILS);
        }
        else if (options.showOnlyFails && options.darkTheme && !options.template) {
            var htmlTemplate = path.join(__dirname, SHOW_ONLY_FAILS_DARK);
        }
        else {
            var htmlTemplate = options.template || path.join(__dirname, DEFAULT_TEMPLATE);
        }
        var compiler = handlebars.compile(fs.readFileSync(htmlTemplate, FILE_READ_OPTIONS));
    
        newman.on('assertion', function (err, o) {
            if (err) { return; }
    
            if (o.skipped) {
                this.summary.skippedTests = this.summary.skippedTests || [];
    
                this.summary.skippedTests.push({
                    cursor: {
                        ref: o.cursor.ref,
                        iteration: o.cursor.iteration,
                        scriptId: o.cursor.scriptId
                    },
                    assertion: o.assertion,
                    skipped: o.skipped,
                    error: o.error,
                    item: {
                        id: o.item.id,
                        name: o.item.name
                    }
                });
            }
        });
    
    
        newman.on('console', function (err, o) {
            if (err) { return; }
    
            if (options.logs) {
                this.summary.consoleLogs = this.summary.consoleLogs || [];
    
                this.summary.consoleLogs.push({
                    cursor: {
                        ref: o.cursor.ref,
                        iteration: o.cursor.iteration,
                        scriptId: o.cursor.scriptId
                    },
                    level: o.level,
                    messages: o.messages
                });
            }
        });
    
        newman.on('beforeDone', function () {
            var items = {},
                executionMeans = {},
                netTestCounts = {},
                aggregations = [],
                traversedRequests = {},
                aggregatedExecutions = {},
                executions = _.get(this, 'summary.run.executions'),
                assertions = _.transform(executions, function (result, currentExecution) {
                    var stream,
                        reducedExecution,
                        executionId = currentExecution.cursor.ref;
    
                    if (!_.has(traversedRequests, executionId)) {
                        _.set(traversedRequests, executionId, 1);
    
                        _.set(result, executionId, {});
                        _.set(netTestCounts, executionId, { passed: 0, failed: 0, skipped: 0 });
    
                        _.set(executionMeans, executionId, { time: { sum: 0, count: 0 }, size: { sum: 0, count: 0 } });
    
                        reducedExecution = _.pick(currentExecution, AGGREGATED_FIELDS);
    
                        if (reducedExecution.response && _.isFunction(reducedExecution.response.toJSON)) {
                            reducedExecution.response = reducedExecution.response.toJSON();
                            stream = reducedExecution.response.stream;
                            reducedExecution.response.body = Buffer.from(stream).toString();
                        }
    
                        items[reducedExecution.cursor.ref] = reducedExecution;
                    }
    
                    executionMeans[executionId].time.sum += _.get(currentExecution, 'response.responseTime', 0);
                    executionMeans[executionId].size.sum += _.get(currentExecution, 'response.responseSize', 0);
    
                    ++executionMeans[executionId].time.count;
                    ++executionMeans[executionId].size.count;
    
                    _.forEach(currentExecution.assertions, function (assertion) {
                        var aggregationResult,
                            assertionName = assertion.assertion,
                            testName = _.get(assertion, 'error.test') || undefined,
                            errorMessage = _.get(assertion, 'error.message') || undefined,
                            isError = _.get(assertion, 'error') !== undefined,
                            isSkipped = _.get(assertion, 'skipped');
    
                        result[executionId][assertionName] = result[executionId][assertionName] || {
                            name: assertionName,
                            testFailure: { test: testName, message: errorMessage },
                            passed: 0,
                            failed: 0,
                            skipped: 0
                        };
                        aggregationResult = result[executionId][assertionName];
    
                        if (isError && isSkipped !== true) {
                            aggregationResult.failed++;
                            netTestCounts[executionId].failed++;
                        }
                        else if (isSkipped) {
                            aggregationResult.skipped++;
                            netTestCounts[executionId].skipped++;
                        }
                        else if (isError === false && isSkipped === false) {
                            aggregationResult.passed++;
                            netTestCounts[executionId].passed++;
                        }
                    });
                }, {}),
    
                aggregator = function (execution) {
                    var aggregationMean = executionMeans[execution.cursor.ref],
                        meanTime = _.get(aggregationMean, 'time', 0),
                        meanSize = _.get(aggregationMean, 'size', 0),
                        parent = execution.item.parent(),
                        iteration = execution.cursor.iteration,
                        previous = _.last(aggregations),
                        current = _.merge(items[execution.cursor.ref], {
                            assertions: _.values(assertions[execution.cursor.ref]),
                            mean: {
                                time: util.prettyms(meanTime.sum / meanTime.count),
                                size: util.filesize(meanSize.sum / meanSize.count)
                            },
                            cumulativeTests: netTestCounts[execution.cursor.ref]
                        });
    
                    if (aggregatedExecutions[execution.cursor.ref]) { return; }
    
                    aggregatedExecutions[execution.cursor.ref] = true;
    
                    if (previous && parent.id === previous.parent.id) {
                        previous.executions.push(current);
                    }
                    else {
                        aggregations.push({
                            parent: {
                                id: parent.id,
                                name: util.getFullName(parent),
                                description: parent.description,
                                iteration: iteration
                            },
                            executions: [current]
                        });
                    }
                };
    
            _.forEach(this.summary.run.executions, aggregator);
    
                var reportHTML = compiler({
                    timestamp: Date(),
                    version: '4.5.1',
                    aggregations: aggregations,
                    summary: {
                        stats: this.summary.run.stats,
                        collection: this.summary.collection,
                        globals: _.isObject(this.summary.globals) ? this.summary.globals : undefined,
                        environment: _.isObject(this.summary.environment) ? this.summary.environment : undefined,
                        failures: this.summary.run.failures,
                        responseTotal: util.filesize(this.summary.run.transfers.responseTotal),
                        responseAverage: util.prettyms(this.summary.run.timings.responseAverage),
                        duration: util.prettyms(this.summary.run.timings.completed - this.summary.run.timings.started),
                        skippedTests: _.isObject(this.summary.skippedTests) ? this.summary.skippedTests : undefined,
                        consoleLogs: _.isObject(this.summary.consoleLogs) ? this.summary.consoleLogs : undefined
                    }
                });

                report.html=reportHTML;
        });
    };
    
    module.exports = PostmanHTMLExtraSenderReport;
