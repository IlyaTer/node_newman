var postmanSenderReport = require('./reporter');
var newman = require('newman');
var amqp = require('amqplib/callback_api');
var events = require('events');

const RMQ_HOST = 'amqp://localhost';
const RECEIVE_COLLECTION_EXCHANGE = 'testExchange';
const RECEIVE_COLLECTION_QUEUE = 'test_queue_1';
const SEND_REPORT_EXCHANGE = 'testREPExchange';

var eventEmitter = new events.EventEmitter();

amqp.connect(RMQ_HOST, function (connectError, connection) {

    if (connectError) {
        throw connectError;
    }

    connection.createChannel(function (channelError, channel) {
        if (channelError) {
            throw channelError;
        }

        channel.assertExchange(SEND_REPORT_EXCHANGE, 'fanout', {
            durable: true
        });

        eventEmitter.on('sendReport', function (report) {
            channel.publish(SEND_REPORT_EXCHANGE, '',
                Buffer.from(JSON.stringify(report)));
            console.log('From Emiter)');
        });


    });

    connection.createChannel(function (channelError, channel) {

        if (channelError) {
            throw channelError;
        }

        channel.assertExchange(RECEIVE_COLLECTION_EXCHANGE, 'fanout', {
            durable: true
        });

        channel.prefetch(1);

        channel.assertQueue(RECEIVE_COLLECTION_QUEUE, {
            exclusive: false
        }, function (queueError) {

            if (queueError) {
                throw queueError;
            }

            channel.bindQueue(RECEIVE_COLLECTION_QUEUE,
                RECEIVE_COLLECTION_EXCHANGE, '');

            channel.consume(RECEIVE_COLLECTION_QUEUE,
                function (message) {
                    console.log('Recive message');

                    var testObject = JSON.parse(message.content.toString());

                    if ('collection' in testObject) {
                        if ('environment' in testObject) {
                            var report = {};

                            var newmanRun = newman.run({
                                collection: testObject.collection,
                                environment: testObject.environment,
                                reporters: 'cli'
                            }, function (err) {
                                if (err) {
                                    throw err;
                                }
                                eventEmitter.emit('sendReport', report);
                            });
                            postmanSenderReport(newmanRun,{},null, report);
                        } else {
                            console.log("Error: message hasn't got a mandatory field (environment)")
                        }
                    } else {
                        console.log("Error: message hasn't got a mandatory field (collection)")
                    }
                    channel.ack(message);
                }, {
                    noAck: false
                });
        });
    });//end create channel
    console.log("async");
});//end connect


