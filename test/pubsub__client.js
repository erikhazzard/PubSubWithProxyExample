/**
 *
 * PubsSub client tests with redis connector
 *
 * NOTE: This assumes `redis-server` is running
 *
 * @module tests/pubsub__client.js
 */
var _ = require('lodash');
var util = require('util');
var uuid = require('uuid');
var chai = require('chai');
var assert = chai.assert;
var should = chai.should();

var pubSubClientFactory = require('../lib/pubsub__client.js');

var getConnWrapper = function () {
    return require('../lib/pubsub__driver-redis-instance.js');
};

/**
 *
 * Tests
 *
 */
describe('PubSub Client Tests', function () {
    it('should create a pubsub client', function (done) {
        var pubSubClientFactory = require('../lib/pubsub__client.js');
        var pubSubClient1 = pubSubClientFactory({});
        var pubSubClient2 = pubSubClientFactory({});

        // some basic tests to ensure we got different objects
        assert(pubSubClient1 !== pubSubClient2);
        pubSubClient1.id.should.not.equal(pubSubClient2.id);
        // _id can be read, but not modified
        pubSubClient1.id = 42;
        assert(pubSubClient1.id !== 42);

        // publish functions are references
        assert(pubSubClient1.publish === pubSubClient2.publish);

        // subscribe and unsubcribe functions are closures
        assert(pubSubClient1.subscribe !== pubSubClient2.subscribe);

        done();
    });

    /**
     * Test successes
     */
    it('should successfully publish a message but get no message when no subs', function (done) {
        var routingKey = uuid.v4();
        var pubSubClient1 = pubSubClientFactory({ connectionWrapper: getConnWrapper() });
        pubSubClient1.publish(routingKey, {message: 'Hello world'});

        setTimeout(() => {
            assert(!pubSubClient1.connectionWrapper._numSubscriptionsByRoutingKey[routingKey]);
            assert(!pubSubClient1.numMessagesPerRoutingKey[routingKey]);
            done();
        }, 40);
    });

    it('should successfully publish a message', function (done) {
        var pubSubClient1 = pubSubClientFactory({ connectionWrapper: getConnWrapper() });
        var routingKey = uuid.v4();

        pubSubClient1.subscribe(routingKey, (message) => {
            assert(message);
            done();
        });

        pubSubClient1.publish(routingKey, {message: 'first pub test'}, (err, res) => {
            assert(!err);
        });
    });

    it('should successfully subscribe, publish, and unsubscribe', function (done) {
        var pubSubClient1 = pubSubClientFactory({ connectionWrapper: getConnWrapper() });
        var routingKey = uuid.v4();

        pubSubClient1.subscribe(routingKey, (message) => {
            // TODO: test counts of subscribers, callbacks, etc.
            assert(message.message === 'second pub test');
            assert(pubSubClient1.connectionWrapper._numSubscriptionsByRoutingKey[routingKey] === 1);
            pubSubClient1.numMessagesPerRoutingKey[routingKey].should.equal(1);


            // after getting a message, unsuscribe
            pubSubClient1.unsubscribe(routingKey);

            pubSubClient1.publish(routingKey, {message: 'second pub test'}, () => {});

            setTimeout(() => {
                // should NOT have gotten a new message
                pubSubClient1.numMessagesPerRoutingKey[routingKey].should.equal(1);
                done();
            }, 40);
        });

        pubSubClient1.publish(routingKey, {message: 'second pub test'}, (err, res) => {
            assert(!err);
        });
    });

    it('should subscribe multiple times (and unsubscribe implictly)', function (done) {
        var pubSubClient1 = pubSubClientFactory({ connectionWrapper: getConnWrapper() });
        var routingKey = uuid.v4();
        var messagesFromFirstSub = 0;

        // function 1
        pubSubClient1.subscribe(routingKey, (message) => {
            messagesFromFirstSub++;
            pubSubClient1.numMessagesPerRoutingKey[routingKey].should.equal(1);
        });

        pubSubClient1.publish(routingKey, {message: 'multiple subs'});

        setTimeout(() => {
            pubSubClient1.subscribe(routingKey, (message) => {
                // should have 2 total messages, but only 1 from the first
                // subscriber
                messagesFromFirstSub.should.equal(1);
                setTimeout(function () {
                pubSubClient1.numMessagesPerRoutingKey[routingKey].should.equal(2);
                    pubSubClient1.unsubscribe(routingKey);
                    // reset values
                    pubSubClient1.numMessagesPerRoutingKey = {};
                    done();
                }, 100);
            });

            setTimeout(() => {
                pubSubClient1.publish(routingKey, {message: 'multiple subs'});
            }, 20);
        }, 40);
    });

    it('should get a lot of messages', function (done) {
        var pubSubClient1 = pubSubClientFactory({ connectionWrapper: getConnWrapper() });
        var routingKey = uuid.v4();
        var messagesReceived = 0;
        var numToPublish = 100;

        // function 1
        pubSubClient1.subscribe(routingKey, (message) => {
            messagesReceived++;

            if (messagesReceived === numToPublish) {
                pubSubClient1.numMessagesPerRoutingKey[routingKey].should.equal(messagesReceived);

                setTimeout(done, 100);

            } else if (messagesReceived > numToPublish) {
                throw new Error('Too many messages received');
                assert(false);
            }
        });

        _.each(_.range(numToPublish), (i) => {
            setTimeout(() => {
                pubSubClient1.publish(routingKey, {message: i});
            }, i * 1);
        });
    });

    // Multiple subs
    it('should get a lot of messages on multiple subscribers', function (done) {
        var routingKey = uuid.v4();

        var messagesReceived = 0;
        var numClients = 1000;
        var numToPublish = 1000;

        var totalExpectedMessages = numClients * numToPublish;
        var pubSubClients = [];

        _.each(_.range(numClients), function (i) {
            var client = pubSubClientFactory({ connectionWrapper: getConnWrapper() });
            pubSubClients.push(client);

            client.subscribe(routingKey, (message) => {
                messagesReceived++;

                if (messagesReceived === totalExpectedMessages) {
                    assert(totalExpectedMessages === messagesReceived);
                    setTimeout(done, 200);

                } else if (messagesReceived > totalExpectedMessages) {
                    throw new Error('Too many messages received');
                }
            });
        });

        _.each(_.range(numToPublish), (i) => {
            setImmediate(() => {
                pubSubClients[0].publish(routingKey, {message: i});
            });
        });
    });
});
