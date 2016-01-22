/**
 *
 * tests timing for many event emitters
 *
 */
var d3 = require('d3');
var _ = require('lodash');
var async = require('async');
var microtime = require('microtime');

var EventEmitter = require('events').EventEmitter;

var events = new EventEmitter();
events.setMaxListeners(0);

/**
 *
 * Config
 *
 */
var NUM_CALLBACKS = 10000;

var start;
var numMessagesReceived = 0;
var totalMessagesReceived = 0;
var totalMessagesReceivedPerSecond = 0;
var messagesPerSecond = 0;

setInterval(function () {
    console.log('>>> ' + d3.format(',')(messagesPerSecond) + ' messages per second');
    console.log('\t Total Messages Received: ' + d3.format(',')(totalMessagesReceived));
    console.log('\t Messages Per Second: ' + d3.format(',')(totalMessagesReceivedPerSecond));
    messagesPerSecond = 0;
    totalMessagesReceivedPerSecond = 0;
}, 1000);

/**
 *
 * Test processing
 *
 */
events.on('testDone', function (message) {
    // log 0.1% of the time
    if (Math.random() < 0.001) {
        console.log('<' + d3.format(',')(NUM_CALLBACKS) +
        ' connections> ' + numMessagesReceived + ' messages received | ' +
        message.diff + 'ms total time | ' + 'last message diff: ' +
        message.diffMessage + 'ms');
    }
});


/**
 *
 * Test
 *
 */
console.log('setting up subscribers: ' + NUM_CALLBACKS);
async.eachLimit(_.range(NUM_CALLBACKS), 100,
    function setupCallback (i, cb) {
        events.on('message', function (message) {
            numMessagesReceived++;
            totalMessagesReceived++;
            totalMessagesReceivedPerSecond++;

            if ((numMessagesReceived) === (NUM_CALLBACKS)) {
                events.emit('testDone', {
                    diff: (microtime.now() - start) / 1000,
                    diffMessage: (microtime.now() - message.time) / 1000,
                    numMessagesReceived: numMessagesReceived
                });
                numMessagesReceived = 0;
                start = microtime.now();
            }
        });

        setImmediate(cb);
    },
    function testPublish () {
        console.log('Publishing message');
        start = microtime.now();
        function pub () {
            messagesPerSecond++;
            events.emit('message', {channel: 'room1', message: 'hello', time: microtime.now()});
            setImmediate(pub);
        }
        setImmediate(pub);
    }
);

// keep alive
setInterval(function () { }, 10000);
