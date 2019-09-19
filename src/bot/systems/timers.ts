'use strict';

import crypto from 'crypto';
import * as _ from 'lodash';
import { isMainThread } from 'worker_threads';

import { getOwner, sendMessage } from '../commons';
import { command, default_permission } from '../decorators';
import { permission } from '../permissions';
import System from './_interface';
import uuid from 'uuid';

/*
 * !timers                                                                                                                      - gets an info about timers usage
 * !timers set -name [name-of-timer] -messages [num-of-msgs-to-trigger|default:0] -seconds [trigger-every-x-seconds|default:60] - add new timer
 * !timers unset -name [name-of-timer]                                                                                          - remove timer
 * !timers add -name [name-of-timer] -response '[response]'                                                                     - add new response to timer
 * !timers rm -id [response-id]                                                                                                 - remove response by id
 * !timers toggle -name [name-of-timer]                                                                                         - enable/disable timer by name
 * !timers toggle -id [id-of-response]                                                                                          - enable/disable response by id
 * !timers list                                                                                                                 - get timers list
 * !timers list -name [name-of-timer]                                                                                           - get list of responses on timer
 */

class Timers extends System {
  constructor () {
    super();

    this.addMenu({ category: 'manage', name: 'timers', id: 'timers/list' });
    if (isMainThread) {
      global.db.engine.index(this.collection.data, { index: 'id', unique: true });
      global.db.engine.index(this.collection.responses, { index: 'timerId' });

      this.init();
    }
  }

  sockets () {
    if (this.socket === null) {
      return setTimeout(() => this.sockets(), 100);
    }

    this.socket.on('connection', (socket) => {
      socket.on('find.timers', async (callback) => {
        const [timers, responses] = await Promise.all([
          global.db.engine.find(this.collection.data),
          global.db.engine.find(this.collection.responses),
        ]);
        callback(null, { timers: timers, responses: responses });
      });
      socket.on('findOne.timer', async (opts, callback) => {
        const [timer, responses] = await Promise.all([
          global.db.engine.findOne(this.collection.data, { id: opts.id }),
          global.db.engine.find(this.collection.responses, { timerId: opts.id }),
        ]);
        callback(null, { timer: timer, responses: responses });
      });
      socket.on('delete.timer', async (id, callback) => {
        await Promise.all([
          global.db.engine.remove(this.collection.data, { id }),
          global.db.engine.remove(this.collection.responses, { timerId: id }),
        ]);
        callback(null);
      });
      socket.on('update.timer', async (data, callback) => {
        const name = data.timer.name && data.timer.name.trim().length ? data.timer.name.replace(/ /g, '_') : crypto.createHash('md5').update(new Date().getTime().toString()).digest('hex').slice(0, 5);
        _.remove(data.responses, (o: any) => o.response.trim().length === 0);

        const timer = {
          id: uuid(),
          name: name,
          messages: _.toNumber(data.timer.messages),
          seconds: _.toNumber(data.timer.seconds),
          enabled: data.timer.enabled,
          trigger: {
            messages: 0,
            timestamp: new Date().getTime(),
          },
        };
        if (_.isNil(data.timer.id)) {
          await global.db.engine.insert(this.collection.data, timer);
          data.timer.id = timer.id;
        } else {
          await Promise.all([
            global.db.engine.update(this.collection.data, { id: data.timer.id }, timer),
            global.db.engine.remove(this.collection.responses, { timerId: data.timer.id }),
          ]);
        }

        const insertArray: any[] = [];
        for (const response of data.responses) {
          insertArray.push(global.db.engine.insert(this.collection.responses, {
            timerId: data.timer.id,
            response: response.response,
            enabled: response.enabled,
            timestamp: 0,
          }));
        }
        await Promise.all(insertArray);
        callback(null, {
          timer: await global.db.engine.findOne(this.collection.data, { id: data.timer.id }),
          responses: await global.db.engine.find(this.collection.responses, { timerId: data.timer.id }),
        });
      });
    });
  }

  async send (self, socket) {
    socket.emit(this.collection.data, { timers: await global.db.engine.find(this.collection.data), responses: await global.db.engine.find(this.collection.responses) });
  }

  @command('!timers')
  @default_permission(permission.CASTERS)
  async main (opts) {
    const [main, set, unset, add, rm, toggle, list] = [
      this.getCommand('!timers'),
      this.getCommand('!timers set'),
      this.getCommand('!timers unset'),
      this.getCommand('!timers add'),
      this.getCommand('!timers rm'),
      this.getCommand('!timers toggle'),
      this.getCommand('!timers list'),
    ];
    sendMessage('╔ ' + global.translate('core.usage'), opts.sender, opts.attr);
    sendMessage(`║ ${main} - gets an info about timers usage`, opts.sender, opts.attr);
    sendMessage(`║ ${set} -name [name-of-timer] -messages [num-of-msgs-to-trigger|default:0] -seconds [trigger-every-x-seconds|default:60] - add new timer`, opts.sender, opts.attr);
    sendMessage(`║ ${unset} -name [name-of-timer] - remove timer`, opts.sender, opts.attr);
    sendMessage(`║ ${add} -name [name-of-timer] -response '[response]' - add new response to timer`, opts.sender, opts.attr);
    sendMessage(`║ ${rm} -id [response-id] - remove response by id`, opts.sender, opts.attr);
    sendMessage(`║ ${toggle} -name [name-of-timer] - enable/disable timer by name`, opts.sender, opts.attr);
    sendMessage(`║ ${toggle} -id [id-of-response] - enable/disable response by id`, opts.sender, opts.attr);
    sendMessage(`║ ${list} - get timers list`, opts.sender, opts.attr);
    sendMessage(`╚ ${list} -name [name-of-timer] - get list of responses on timer`, opts.sender, opts.attr);
  }

  async init () {
    const timers = await global.db.engine.find(this.collection.data);
    for (const timer of timers) {
      await global.db.engine.update(this.collection.data, { id: timer.id }, { trigger: { messages: 0, timestamp: new Date().getTime() } });
    }
    this.check();
  }

  async check () {
    clearTimeout(this.timeouts.timersCheck);

    const timers = await global.db.engine.find(this.collection.data, { enabled: true });
    for (const timer of timers) {
      if (timer.messages > 0 && timer.trigger.messages - global.linesParsed + timer.messages > 0) {
        continue;
      } // not ready to trigger with messages
      if (timer.seconds > 0 && new Date().getTime() - timer.trigger.timestamp < timer.seconds * 1000) {
        continue;
      } // not ready to trigger with seconds

      const responses = await global.db.engine.find(this.collection.responses, { timerId: timer.id, enabled: true });
      const response = _.orderBy(responses, 'timestamp', 'asc')[0];

      if (!_.isNil(response)) {
        const userObj = await global.users.getByName(getOwner());
        sendMessage(response.response, {
          username: userObj.username,
          displayName: userObj.displayName || userObj.username,
          userId: userObj.id,
          emotes: [],
          badges: {},
          'message-type': 'chat',
        });
        await global.db.engine.update(this.collection.responses, { id: response.id }, { timestamp: new Date().getTime() });
      }
      await global.db.engine.update(this.collection.data, { id: timer.id }, { trigger: { messages: global.linesParsed, timestamp: new Date().getTime() } });
    }
    this.timeouts.timersCheck = global.setTimeout(() => this.check(), 1000); // this will run check 1s after full check is correctly done
  }

  async editName (self, socket, data) {
    if (data.value.length === 0) {
      await self.unset(self, null, `-name ${data.id}`);
    } else {
      const name = data.value.match(/([a-zA-Z0-9_]+)/);
      if (_.isNil(name)) {
        return;
      }
      await global.db.engine.update(this.collection.data, { name: data.id }, { name: name[0] });
    }
  }

  async editResponse (self, socket, data) {
    if (data.value.length === 0) {
      await self.rm(self, null, `-id ${data.id}`);
    } else {
      global.db.engine.update(this.collection.responses, { id: data.id }, { response: data.value });
    }
  }

  @command('!timers set')
  @default_permission(permission.CASTERS)
  async set (opts) {
    // -name [name-of-timer] -messages [num-of-msgs-to-trigger|default:0] -seconds [trigger-every-x-seconds|default:60]
    let name = opts.parameters.match(/-name ([a-zA-Z0-9_]+)/);
    let messages = opts.parameters.match(/-messages ([0-9]+)/);
    let seconds = opts.parameters.match(/-seconds ([0-9]+)/);

    if (_.isNil(name)) {
      sendMessage(global.translate('timers.name-must-be-defined'), opts.sender, opts.attr);
      return false;
    } else {
      name = name[1];
    }

    messages = _.isNil(messages) ? 0 : parseInt(messages[1], 10);
    seconds = _.isNil(seconds) ? 60 : parseInt(seconds[1], 10);

    if (messages === 0 && seconds === 0) {
      sendMessage(global.translate('timers.cannot-set-messages-and-seconds-0'), opts.sender, opts.attr);
      return false;
    }
    await global.db.engine.update(this.collection.data, { name: name }, { name: name, messages: messages, seconds: seconds, enabled: true, trigger: { messages: global.linesParsed, timestamp: new Date().getTime() } });
    sendMessage(global.translate('timers.timer-was-set')
      .replace(/\$name/g, name)
      .replace(/\$messages/g, messages)
      .replace(/\$seconds/g, seconds), opts.sender);
  }

  @command('!timers unset')
  @default_permission(permission.CASTERS)
  async unset (opts) {
    // -name [name-of-timer]
    let name = opts.parameters.match(/-name ([\S]+)/);

    if (_.isNil(name)) {
      sendMessage(global.translate('timers.name-must-be-defined'), opts.sender, opts.attr);
      return false;
    } else {
      name = name[1];
    }

    const timer = await global.db.engine.findOne(this.collection.data, { name: name });
    if (_.isEmpty(timer)) {
      sendMessage(global.translate('timers.timer-not-found').replace(/\$name/g, name), opts.sender, opts.attr);
      return false;
    }

    await global.db.engine.remove(this.collection.data, { name: name });
    await global.db.engine.remove(this.collection.responses, { timerId: timer.id });
    sendMessage(global.translate('timers.timer-deleted')
      .replace(/\$name/g, name), opts.sender);
  }

  @command('!timers rm')
  @default_permission(permission.CASTERS)
  async rm (opts) {
    // -id [id-of-response]
    let id = opts.parameters.match(/-id ([a-zA-Z0-9]+)/);

    if (_.isNil(id)) {
      sendMessage(global.translate('timers.id-must-be-defined'), opts.sender, opts.attr);
      return false;
    } else {
      id = id[1];
    }

    await global.db.engine.remove(this.collection.responses, { id: id });
    sendMessage(global.translate('timers.response-deleted')
      .replace(/\$id/g, id), opts.sender);
  }

  @command('!timers add')
  @default_permission(permission.CASTERS)
  async add (opts) {
    // -name [name-of-timer] -response '[response]'
    let name = opts.parameters.match(/-name ([\S]+)/);
    let response = opts.parameters.match(/-response ['"](.+)['"]/);

    if (_.isNil(name)) {
      sendMessage(global.translate('timers.name-must-be-defined'), opts.sender, opts.attr);
      return false;
    } else {
      name = name[1];
    }

    if (_.isNil(response)) {
      sendMessage(global.translate('timers.response-must-be-defined'), opts.sender, opts.attr);
      return false;
    } else {
      response = response[1];
    }
    const timer = await global.db.engine.findOne(this.collection.data, { name: name });
    if (_.isEmpty(timer)) {
      sendMessage(global.translate('timers.timer-not-found')
        .replace(/\$name/g, name), opts.sender);
      return false;
    }

    const item = await global.db.engine.insert(this.collection.responses, {
      response,
      timestamp: new Date().getTime(),
      enabled: true,
      timerId: timer.id,
    });
    sendMessage(global.translate('timers.response-was-added')
      .replace(/\$id/g, item.id)
      .replace(/\$name/g, name)
      .replace(/\$response/g, response), opts.sender);
  }

  @command('!timers list')
  @default_permission(permission.CASTERS)
  async list (opts) {
    // !timers list -name [name-of-timer]
    let name = opts.parameters.match(/-name ([\S]+)/);

    if (_.isNil(name)) {
      const timers = await global.db.engine.find(this.collection.data);
      sendMessage(global.translate('timers.timers-list').replace(/\$list/g, _.map(_.orderBy(timers, 'name'), (o) => (o.enabled ? '⚫' : '⚪') + ' ' + o.name).join(', ')), opts.sender, opts.attr);
      return true;
    } else {
      name = name[1];
    }

    const timer = await global.db.engine.findOne(this.collection.data, { name: name });
    if (_.isEmpty(timer)) {
      sendMessage(global.translate('timers.timer-not-found')
        .replace(/\$name/g, name), opts.sender);
      return false;
    }

    const responses = await global.db.engine.find(this.collection.responses, { timerId: timer.id });
    await sendMessage(global.translate('timers.responses-list').replace(/\$name/g, name), opts.sender, opts.attr);
    for (const response of responses) {
      await sendMessage((response.enabled ? '⚫ ' : '⚪ ') + `${response.id} - ${response.response}`, opts.sender, opts.attr);
    }
    return true;
  }

  @command('!timers toggle')
  @default_permission(permission.CASTERS)
  async toggle (opts) {
    // -name [name-of-timer] or -id [id-of-response]
    let id = opts.parameters.match(/-id ([a-zA-Z0-9]+)/);
    let name = opts.parameters.match(/-name ([\S]+)/);

    if ((_.isNil(id) && _.isNil(name)) || (!_.isNil(id) && !_.isNil(name))) {
      sendMessage(global.translate('timers.id-or-name-must-be-defined'), opts.sender, opts.attr);
      return false;
    }

    if (!_.isNil(id)) {
      id = id[1];
      const response = await global.db.engine.findOne(this.collection.responses, { id: id });
      if (_.isEmpty(response)) {
        sendMessage(global.translate('timers.response-not-found').replace(/\$id/g, id), opts.sender, opts.attr);
        return false;
      }

      await global.db.engine.update(this.collection.responses, { id: id }, { enabled: !response.enabled });
      sendMessage(global.translate(!response.enabled ? 'timers.response-enabled' : 'timers.response-disabled')
        .replace(/\$id/g, id), opts.sender);
      return true;
    }

    if (!_.isNil(name)) {
      name = name[1];
      const timer = await global.db.engine.findOne(this.collection.data, { name: name });
      if (_.isEmpty(timer)) {
        sendMessage(global.translate('timers.timer-not-found').replace(/\$name/g, name), opts.sender, opts.attr);
        return false;
      }

      await global.db.engine.update(this.collection.data, { name: name }, { enabled: !timer.enabled });
      sendMessage(global.translate(!timer.enabled ? 'timers.timer-enabled' : 'timers.timer-disabled')
        .replace(/\$name/g, name), opts.sender);
      return true;
    }
  }
}

export default Timers;
export { Timers };
