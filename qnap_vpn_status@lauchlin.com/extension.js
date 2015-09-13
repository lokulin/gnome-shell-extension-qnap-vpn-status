
const St = imports.gi.St;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const Lang = imports.lang;
const GXml = imports.gi.GXml;

let baseURI = 'https://qnap/cgi-bin';
let username = 'admin';
let password = 'password';

let text, button, sid, vpnStatus, tx, rx, timestamp, previousTx, previousRx;

let network_offline_icon = new St.Icon({ icon_name: 'network-offline-symbolic',
                             style_class: 'system-status-icon' });
let network_online_icon = new St.Icon({ icon_name: 'network-idle-symbolic',
                             style_class: 'system-status-icon' });
let network_tx_icon = new St.Icon({ icon_name: 'network-transmit-symbolic',
                             style_class: 'system-status-icon' });
let network_rx_icon = new St.Icon({ icon_name: 'network-receive-symbolic',
                             style_class: 'system-status-icon' });
let network_txrx_icon = new St.Icon({ icon_name: 'network-transmit-receive-symbolic',
                             style_class: 'system-status-icon' });

if (!_httpSession) {
    const _httpSession = new Soup.SessionAsync();
    _httpSession.timeout = 10;
}

function find_node_by_path(xmldoc,xpath) {
  var element = xmldoc.document_element;
  var path = xpath.split('/');
  var root_tag = path.shift();
  if (element.node_name == root_tag) {
    return _find_node_by_path(element.child_nodes, path);
  }
  return null;
}

function _find_node_by_path(node_list,path) {
  var tag = path.shift();
  for (var i = 0; i < node_list.size; i++) {
    var node = node_list.get(i);
    if(node.node_name == tag) {
      if(path.length == 0) {
        return node;
      } else {
        return _find_node_by_path(node.child_nodes,path);
      }
    }
  }
  return null;
}

var ezEncodeChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf16to8(str) {
  var out, i, len, c;
  out = "";
  len = str.length;
  for (i=0; i<len; i++) {
    c = str.charCodeAt(i);
    if ((c >= 0x0001) && (c <= 0x007F)) {
      out += str.charAt(i);
    } else if (c > 0x07FF) {
      out += String.fromCharCode(0xE0 | ((c >> 12) & 0x0F));
      out += String.fromCharCode(0x80 | ((c >>6) & 0x3F));
      out += String.fromCharCode(0x80 | ((c >>0) & 0x3F));
    } else {
      out += String.fromCharCode(0xC0 | ((c >>6) & 0x1F));
      out += String.fromCharCode(0x80 | ((c >>0) & 0x3F));
    }
  }
  return out;
}

function ezEncode(str) {
  var out, i, len;
  var c1, c2, c3;

  len = str.length;
  i = 0;
  out = "";
  while(i < len) {
    c1 = str.charCodeAt(i++) & 0xff;
    if(i == len) {
      out += ezEncodeChars.charAt(c1 >> 2);
      out += ezEncodeChars.charAt((c1 & 0x3) << 4);
      out += "==";
      break;
    }
    c2 = str.charCodeAt(i++);
    if(i == len) {
      out += ezEncodeChars.charAt(c1 >> 2);
      out += ezEncodeChars.charAt(((c1 & 0x3)<< 4) | ((c2 & 0xF0) >> 4));
      out += ezEncodeChars.charAt((c2 & 0xF) << 2);
      out += "=";
      break;
    }
    c3 = str.charCodeAt(i++);
    out += ezEncodeChars.charAt(c1 >> 2);
    out += ezEncodeChars.charAt(((c1 & 0x3)<< 4) | ((c2 & 0xF0) >> 4));
    out += ezEncodeChars.charAt(((c2 & 0xF) << 2) | ((c3 & 0xC0) >> 6));
    out += ezEncodeChars.charAt(c3 & 0x3F);
  }
  return out;
}

function _hideText() {
    Main.uiGroup.remove_actor(text);
    text = null;
}

function _showText(message) {
    if (!text) {
        text = new St.Label({ style_class: 'text-label', text: message });
        Main.uiGroup.add_actor(text);
    }

    text.opacity = 255;

    let monitor = Main.layoutManager.primaryMonitor;

    text.set_position(monitor.x + Math.floor(monitor.width / 2 - text.width / 2),
                      monitor.y + Math.floor(monitor.height / 2 - text.height / 2));

    Tweener.addTween(text,
                     { opacity: 0,
                       time: 1,
                       transition: 'easeOutQuad',
                       onComplete: _hideText });
}


function _toggleIcon() {
    if (vpnStatus != "1") {
      button.set_child(network_offline_icon);
    } else if (tx > previousTx && rx > previousRx) {
      button.set_child(network_txrx_icon);
    } else if (tx > previousTx) {
      button.set_child(network_tx_icon);
    } else if (rx > previousRx) {
      button.set_child(network_rx_icon);
    } else {
      button.set_child(network_online_icon);
    }
}

function _getXMLDoc(message, callback) {
    _httpSession.queue_message(message, Lang.bind(this, function(session, msg) {
        if (msg.status_code=="200") {
            var response = msg.response_body.data;
            var xmldoc = GXml.xDocument.from_string(response);
            callback(xmldoc);
        }}));
}

function _authenticate() {
  let message = Soup.Message.new('GET', baseURI + '/authLogin.cgi?user=' + username + '&pwd=' + ezEncode(utf16to8(password)));
  _getXMLDoc(message, function(xmldoc) {
    if(_isAuthed(xmldoc)) {
      sid = find_node_by_path(xmldoc,'QDocRoot/authSid').content;
    }
  });
}

function _isAuthed(xmldoc) {
  return find_node_by_path(xmldoc,"QDocRoot/authPassed").content == "1";
}


function _getVPNStats() {
  let message = Soup.Message.new('GET', baseURI + '/application/appRequest.cgi?subfunc=vpn_client&sid=' + sid);
  _getXMLDoc(message, function(xmldoc) {
    if(_isAuthed(xmldoc)) {
      previousRx = rx;
      previousTx = tx;
      vpnStatus = find_node_by_path(xmldoc, 'QDocRoot/func/ownContent/OpenVPNClient/Data/status').content;
      rx = parseInt(find_node_by_path(xmldoc, 'QDocRoot/func/ownContent/OpenVPNClient/Data/rx').content);
      tx = parseInt(find_node_by_path(xmldoc, 'QDocRoot/func/ownContent/OpenVPNClient/Data/tx').content);
      timestamp = find_node_by_path(xmldoc, 'QDocRoot/func/ownContent/OpenVPNClient/Data/timestamp').content;
      _toggleIcon();
    } else {
      _authenticate();
    }
  });
}

function init() {
    sid = "";
    rx = 0;
    tx = 0;
    previousRx = 0;
    previousTx = 0;
    button = new St.Bin({ style_class: 'panel-button',
                          reactive: true,
                          can_focus: true,
                          x_fill: true,
                          y_fill: false,
                          track_hover: true });
    button.set_child(network_offline_icon);
    _authenticate();
    this._eventLoop = Mainloop.timeout_add(500, Lang.bind(this, function () {
      if ( sid != "" ) {
        _getVPNStats();
      } else {
        _authenticate();
      }
      return true;
    }));
}

function enable() {
    Main.panel._rightBox.insert_child_at_index(button, 0);
}

function disable() {
    Main.panel._rightBox.remove_child(button);
}
