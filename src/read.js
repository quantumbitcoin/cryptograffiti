var CG_NEWEST_TX_NR    = null;
var CG_OLDEST_TX_NR    = null;
var CG_GRAFFITI        = {};
var CG_GRAFFITI_NRS    = [];
var CG_GRAFFITI_NEWS   = [];
var CG_GRAFFITI_OLDS   = [];
var CG_DECODING        = null;
var CG_DECODE_ATTEMPTS = 0;    // Number of times decoding has failed.
var CG_MAX_ATTEMPTS    = 3;
var CG_SCROLL_FIXED    = false;
var CG_IMMATURE_DIV    = null;
var CG_IMMATURE_TIME   = 0;
var CG_IMMATURE_ROW    = 0;
var CG_IMMATURE_BOTTOM = false;
var CG_READ_STEP       = 0;
var CG_ROW_BUFFER_SIZE = 100;  // How many messages should fit into the same row at maximum.
var CG_SCROLL_DELAY    = 500;  // Number of milliseconds for the read tab to scroll.
var CG_READ_SCROLL_KEY = null; // Only the div holding the key gets to auto-scroll to prevent mass scrolling.
var CG_READ_PPS        = 4;
var CG_READ_COOLDOWN   = 0;
var CG_READ_FILTER_KEY = null;
var CG_READ_FILTER_ADDR= null;
var CG_READ_FILTER_TXS = null;
var CG_READ_CENSOR_TXS = {};
var CG_READ_API_OK     = true;
var CG_READ_MIMETYPE   = null;

var CG_READ_JOBS = {
    "cg_read_get_filter" : 1,
    "cg_decode"          : 1
};

var CG_READ_APIS = [
    {
        domain       : "bchsvexplorer.com",
        request      : "https://bchsvexplorer.com/api/tx/%s",
        request_addr : "https://bchsvexplorer.com/api/addr/%s",
        link         : "https://bchsvexplorer.com/tx/%s",
        link_addr    : "https://bchsvexplorer.com/address/%s",
        extract      : "cg_read_extract_insight",
        delay        : 0,
        max_delay    : 2*CG_READ_PPS,
        down         : false,
        fails        : 0
    },
    {
        domain       : "blockchair.com",
        request      : "https://api.blockchair.com/bitcoin-sv/dashboards/transaction/%s",
        link         : "https://blockchair.com/bitcoin-sv/transaction/%s",
        link_addr    : "https://blockchair.com/bitcoin-sv/address/%s",
        extract      : "cg_read_extract_blockchair_dashboard",
        delay        : 0,
        max_delay    : 2*CG_READ_PPS,
        down         : false,
        fails        : 0
    },
    {
        domain       : "bsv.btc.com",
        request      : "https://bsv-chain.api.btc.com/v3/tx/%s?verbose=3",
        link         : "https://bsv.btc.com/%s",
        link_addr    : "https://bsv.btc.com/%s",
        extract      : "cg_read_extract_btc",
        delay        : 0,
        max_delay    : 2*CG_READ_PPS,
        down         : false,
        fails        : 0
    }
];

var CG_READ_API = 0; // Index of the block explorer to use when linking transaction details.

function cg_construct_read(main) {
    var div = cg_init_tab(main, 'cg-tab-read');
    if (div === null) return;

    div.classList.add("cg-read-tab-premature");

    var text = document.createTextNode(CG_TXT_READ_INITIALIZING[CG_LANGUAGE]);

    var span = document.createElement('span');
    span.appendChild(text);
    span.id="cg-read-initializing-span";
    div.appendChild(span);

    div.addEventListener("wheel", cg_read_scroll);

    cg_read_loop();
}

function cg_read_scroll() {
    CG_SCROLL_KEY = true;
}

function cg_read_loop() {
    CG_READ_STEP++;
    if (CG_READ_COOLDOWN > 0) CG_READ_COOLDOWN--;

    var tab  = document.getElementById("cg-tab-read");
    var span = document.getElementById("cg-read-initializing-span");

    for (var i=0, sz = CG_READ_APIS.length; i<sz; i++) {
        if (CG_READ_APIS[i].delay > 0) CG_READ_APIS[i].delay--;
    }

    for (var key in CG_READ_JOBS) {
        if (!CG_READ_JOBS.hasOwnProperty(key)
        ||  CG_READ_JOBS[key] <= 0) continue;

        CG_READ_JOBS[key]--;
        if (CG_READ_JOBS[key] > 0) continue;

        if (window[key]() === false) CG_READ_JOBS[key] = 1;
        else if (CG_READ_JOBS[key] === 0) delete CG_READ_JOBS[key];
    }

    if (tab !== null
    &&  !tab.classList.contains("cg-inactive-tab")
    &&  span === null && CG_READ_COOLDOWN === 0) {
        var near_bottom = cg_read_scrolled_near_bottom(tab);
        var decode_near_bottom = near_bottom;

        var top    = cg_read_scrolled_top   (tab);
        var bottom = cg_read_scrolled_bottom(tab);

        CG_SCROLL_FIXED = false;

        if (cg_read_scrolled_top(tab)) {
            var premature_count = 0;
            var sz = CG_GRAFFITI_NRS.length;
            for (var k=sz-1; k>=0; k--) {
                var nr = CG_GRAFFITI_NRS[k];
                var nr_key = nr.toString(10);
                if (nr_key in CG_GRAFFITI == false) {
                    alert(sprintf(CG_TXT_READ_ERROR_2[CG_LANGUAGE], nr_key));
                    continue;
                }

                if (CG_GRAFFITI[nr_key].premature === false) break;
                if (CG_GRAFFITI[nr_key].premature === true) premature_count++;
            }

            while (CG_DECODING === null && premature_count < CG_ROW_BUFFER_SIZE) {
                if (CG_GRAFFITI_NEWS.length > 0) {
                    var nr = CG_GRAFFITI_NEWS.shift();
                    var nr_key = nr.toString(10);
                    if (nr_key in CG_GRAFFITI) {
                        cg_read_create_graffiti(tab, nr_key, false);
                    }
                    else continue;
                }
                else {
                    if ("cg_read_load_new_txs" in CG_READ_JOBS == false) {
                        CG_READ_JOBS["cg_read_load_new_txs"] = 1*CG_READ_PPS;
                    }
                }
                break;
            }
            CG_SCROLL_FIXED = true;
        }
        else if (cg_read_scroll_visible(tab) < 0.2 && near_bottom) {
            var previousScrollHeightMinusTop = tab.scrollHeight - tab.scrollTop;
            cg_read_delete_graffiti_top(tab);
            tab.scrollTop = tab.scrollHeight - previousScrollHeightMinusTop;
        }

        if (cg_read_scrolled_bottom(tab)) {
            var premature_count = 0;
            var sz = CG_GRAFFITI_NRS.length;
            for (var k=0; k<sz; k++) {
                var nr = CG_GRAFFITI_NRS[k];
                if (nr in CG_GRAFFITI == false) {
                    alert(sprintf(CG_TXT_READ_ERROR_2[CG_LANGUAGE], nr.toString(10)));
                    continue;
                }

                if (CG_GRAFFITI[nr].premature === false) break;
                if (CG_GRAFFITI[nr].premature === true) premature_count++;
            }

            while (CG_DECODING === null && premature_count < CG_ROW_BUFFER_SIZE) {
                if (CG_GRAFFITI_OLDS.length > 0) {
                    var nr = CG_GRAFFITI_OLDS.shift();
                    var nr_key = nr.toString(10);
                    if (nr_key in CG_GRAFFITI) {
                        cg_read_create_graffiti(tab, nr_key, true);
                    }
                    else continue;
                }
                else {
                    if ("cg_read_load_old_txs" in CG_READ_JOBS == false) {
                        CG_READ_JOBS["cg_read_load_old_txs"] = 1*CG_READ_PPS;
                    }
                }
                break;
            }
            CG_SCROLL_FIXED = true;
        }
        else if (cg_read_scroll_visible(tab) < 0.2 && !near_bottom) {
            cg_read_delete_graffiti_bottom(tab);
        }

        if (CG_DECODING === null && (top || bottom)) {
            for (var repeat=0; repeat<2; repeat++) {
                var children = tab.children;

                var i_val = 0;
                var i_mod = 1;
                var i_end = children.length;
                if (decode_near_bottom) {
                    i_val = children.length-1;
                    i_mod = -1;
                    i_end = -1;
                }

                var to_decode = null;

                for (var i = i_val; i !== i_end; i += i_mod) {
                    var child = children[i];

                    if (child.classList.contains('cg-read-loadingbox')) continue;

                    if (!child.classList.contains('cg-hidden'  )
                    ||   child.classList.contains('cg-msgbox-decoding')
                    ||   child.classList.contains('cg-msgbox-decoded' )
                    ||   child.classList.contains('cg-msgbox-failed'  )) break;

                    to_decode = child;
                }

                if (to_decode !== null) {
                    var span = document.getElementById(to_decode.id+"-span");
                    if (span !== null) {
                        var pieces = to_decode.id.split("-");
                        var nr = parseInt(pieces.pop(), 10);
                        CG_DECODING = nr;
                    }
                }

                if (CG_DECODING === null) {
                    decode_near_bottom = !decode_near_bottom;
                    continue;
                }
                else break;
            }
        }

        var previousScrollTop = tab.scrollTop;
        if (cg_read_mature_bottom(tab)) {
            tab.scrollTop = Math.floor(previousScrollTop);
        }
        var previousScrollHeightMinusTop = tab.scrollHeight - tab.scrollTop;
        if (cg_read_mature_top(tab)) {
            tab.scrollTop = Math.ceil(tab.scrollHeight - previousScrollHeightMinusTop);
        }

        var auto_scroll = true;
        if (CG_TX_NR !== null) {
            var mbx = document.getElementById("cg-msgbox-"+CG_TX_NR);
            if (mbx !== null) {
                if (mbx.offsetTop+mbx.offsetHeight/2 > tab.scrollTop
                &&  mbx.offsetTop+mbx.offsetHeight/2 < tab.scrollTop + tab.clientHeight) {
                    auto_scroll = false;
                }
            }
        }
        if (auto_scroll) {
                 if (top)    cg_read_scroll_top(tab);
            else if (bottom) cg_read_scroll_bottom(tab);
        }
    }

    setTimeout(function(){
        cg_read_loop();
    }, 1000/CG_READ_PPS);
}

function cg_decode() {
    var tab  = document.getElementById("cg-tab-read");
    if (tab === null) return false;

    var nr  = CG_DECODING;
    var apis = [];
    var api = null;
    for (var i=0, sz = CG_READ_APIS.length; i<sz; i++) {
             if (CG_READ_APIS[i].delay ===  0) apis.push(i);
        else if (CG_READ_APIS[i].delay === -1) return false; // Already requested.
    }

    if (apis.length > 0) {
        apis = shuffle(apis);
        api = apis[0];
    }

    if (nr === null || api === null) return false;

    var msgbox  = document.getElementById("cg-msgbox-"+nr);
    var msgspan = document.getElementById("cg-msgbox-"+nr+"-span");

    if (nr in CG_GRAFFITI == false || msgbox === null || msgspan === null) {
        CG_DECODING = null;
        CG_DECODE_ATTEMPTS = 0;
        return false;
    }

    msgbox.classList.add("cg-msgbox-decoding");

    while (msgspan.hasChildNodes()) msgspan.removeChild(msgspan.lastChild);
    msgspan.appendChild(document.createTextNode("("+CG_TXT_READ_DECODING_MSG[CG_LANGUAGE]+")"));

    if (CG_GRAFFITI[nr].txid in CG_READ_CENSOR_TXS) {
        CG_READ_APIS[api].delay = -1;
        setTimeout(function(){
            CG_READ_APIS[api].delay = CG_READ_APIS[api].max_delay;
            CG_READ_APIS[api].down  = false;
            CG_READ_JOBS["cg_decode"] = 1;
            CG_DECODING = null;
            CG_DECODE_ATTEMPTS = 0;
            msgbox.classList.remove("cg-msgbox-decoding");
            msgbox.classList.add("cg-msgbox-failed");
            while (msgspan.hasChildNodes()) msgspan.removeChild(msgspan.lastChild);
            msgspan.appendChild(document.createTextNode("("+CG_TXT_READ_MESSAGE_CENSORED[CG_LANGUAGE]+")"));
        }, 100);

        return true;
    }

    var txid  = CG_GRAFFITI[nr].txid;
    var type  = CG_GRAFFITI[nr].type;
    var fsize = CG_GRAFFITI[nr].fsize;
    var fun   = ("fun" in CG_GRAFFITI[nr] ? CG_GRAFFITI[nr].fun : null);
    if (fsize !== null)  fsize  = parseInt(fsize, 10);

    CG_READ_APIS[api].delay = -1;
    xmlhttpGet(sprintf(CG_READ_APIS[api].request, txid), '',
        function(json) {
            CG_READ_APIS[api].delay = CG_READ_APIS[api].max_delay;
            CG_READ_APIS[api].down  = false;
            CG_READ_JOBS["cg_decode"] = 1;
            var nr = CG_DECODING;

            var tab = document.getElementById("cg-tab-read");
            if (tab === null || nr === null) return;

            var msgbox_id     = "cg-msgbox-"+nr;
            var msgbody_id    = "cg-msgbody-"+nr;
            var msgspan_id    = "cg-msgbox-"+nr+"-span";
            var msgheaderR_id = "cg-msgheader-right-"+nr;

            var msgbox     = document.getElementById(msgbox_id);
            var msgbody    = document.getElementById(msgbody_id);
            var msgspan    = document.getElementById(msgspan_id);
            var msgheaderR = document.getElementById(msgheaderR_id);

            //IT IS VALID FOR THESE DIVS TO GET DELETED:
            //if (msgbox     === null) alert(sprintf(CG_TXT_READ_ERROR_1[CG_LANGUAGE], msgbox_id));
            //if (msgspan    === null) alert(sprintf(CG_TXT_READ_ERROR_1[CG_LANGUAGE], msgspan_id));
            //if (msgheaderR === null) alert(sprintf(CG_TXT_READ_ERROR_1[CG_LANGUAGE], msgheaderR_id));

            if (nr in CG_GRAFFITI == false || msgbox     === null
            ||  msgspan === null           || msgheaderR === null
            ||  msgbody === null) {
                CG_DECODING = null;
                CG_DECODE_ATTEMPTS = 0;
                return;
            }

            msgbox.classList.remove("cg-msgbox-decoding");
            if (fun === "get_btc_donations") msgbox.classList.add("cg-msgbox-featured");

            var status = "???";
            var success = false;

            CG_READ_API_OK = false;
                 if (json === false) status = sprintf(CG_TXT_MAIN_API_ERROR[CG_LANGUAGE], CG_READ_APIS[api].domain);
            else if (json === null ) status = sprintf(CG_TXT_MAIN_API_TIMEOUT[CG_LANGUAGE], CG_READ_APIS[api].domain);
            else {
                CG_READ_API_OK = true;
                var response = JSON.parse(json);

                if (typeof response === 'object') {
                    var r = response;
                    var msg  = "";
                    var out_bytes= "";
                    var op_return= "";
                    var timestamp=  0;
                    var op_return_msg = "";
                    var filehash = null;

                    var extract = window[CG_READ_APIS[api].extract](r);
                    if (extract !== null) {
                        out_bytes = extract[0];
                        op_return = extract[1];
                        timestamp = extract[2];

                        var fsz = (fsize !== null ? fsize : is_blockchain_file(out_bytes, type));
                        var blockchain_file = null;
                        if (fsz > 0) {
                            blockchain_file = out_bytes.substr(0, fsz);
                            var comment_start = fsz;
                            var comment_mod   = fsz % 20;
                            if (comment_mod !== 0) {
                                comment_start+= (20-comment_mod);
                            }
                            filehash = out_bytes.slice(comment_start, comment_start + 20);
                            filehash = Bitcoin.createAddressFromText(filehash);
                            out_bytes = out_bytes.slice(comment_start + 20); // 20 to compensate file hash.
                        }

                        var msg_utf8  = decode_utf8(out_bytes);
                        var msg_ascii = decode_ascii(out_bytes);

                        var len_utf8 = msg_utf8.length;
                        var len_ascii= msg_ascii.length;
                             if (len_utf8 <=        1) msg = msg_ascii;
                        else if (len_utf8 < len_ascii) msg = msg_ascii;
                        else                           msg = msg_utf8;

                        op_return_msg = decode_opreturn(op_return);
                        if (op_return_msg.length >  1) {
                            if (msg.length > 1) {msg = msg + "\n";
                                msg = msg + "-----BEGIN OP_RETURN MESSAGE BLOCK-----\n"
                                          + op_return_msg + "\n----- END OP_RETURN MESSAGE BLOCK -----";
                            }
                            else {
                                msg = op_return_msg;
                                msgbox.classList.add("cg-msgbox-prunable");
                            }
                        }
                        var txt = msg;
                        processedTxt = processColours(txt);

                        if (timestamp !== 0 && timestamp !== null) {
                            while (msgheaderR.hasChildNodes()) msgheaderR.removeChild(msgheaderR.lastChild);
                            msgheaderR.appendChild(document.createTextNode(timeConverter(timestamp)));
                        }

                        msgbox.classList.add("cg-msgbox-decoded");
                        while (msgspan.hasChildNodes()) msgspan.removeChild(msgspan.lastChild);

                        for (var i = 0; i < processedTxt.length; i++) {
                            msgspan.appendChild(processedTxt[i])
                        }

                        var isRTL = checkRTL(txt);
                        var dir = isRTL ? 'RTL' : 'LTR';
                        if(dir === 'RTL') msgbody.classList.add("cg-msgbody-rtl");

                        // Conversion hack for compatibility with outdated data:
                             if (type === "UTF8" || type === "ASCII") type = "application/octet-stream";
                        else if (type === "JPG")                      type = "image/jpeg";

                        if (type !== null && type.indexOf("image/") === 0) {
                            var media = document.createElement("DIV");
                            media.classList.add("cg-msgbody-media");

                            var b64imgData = btoa(blockchain_file == null ? out_bytes : blockchain_file);
                            var img = new Image();
                            img.src = "data:"+type+";base64,"+b64imgData;

                            media.appendChild(img);
                            msgbody.insertBefore(media, msgspan);
                        }
                        else if (blockchain_file !== null) {
                            var media = document.createElement("DIV");
                            media.classList.add("cg-msgbody-media");

                            var file_table = cg_read_create_filetable(blockchain_file, type, filehash, fsz);
                            file_table.classList.add("cg-read-filetable");

                            media.appendChild(file_table);
                            msgbody.insertBefore(media, msgspan);

                             if (type.indexOf("text/") === 0
                             ||  type.indexOf("application/pgp") === 0) {
                                media = document.createElement("DIV");
                                media.classList.add("cg-msgbody-media");

                                var utf8 = decode_utf8(blockchain_file);
                                var ta = document.createElement("textarea");
                                ta.readOnly = true;
                                ta.rows = 24;
                                ta.cols = 81;
                                ta.wrap = false;
                                ta.value = utf8;
                                ta.classList.add("cg-view-textarea");
                                media.appendChild(ta);

                                if (type === "text/html"
                                ||  type === "text/markdown") {
                                    var cover = document.createElement("div");
                                    cover.style.position = "absolute";
                                    cover.style.top = "0";
                                    cover.style.bottom = "0";
                                    cover.style.left = "0";
                                    cover.style.right = "0";
                                    cover.style.backgroundColor = "white";

                                    var b64Data = encode_base64(utf8);
                                    var obj = document.createElement('iframe');
                                    var safe_type = (type === "text/html" ? type : "text/plain");
                                    obj.style.width = "100%";
                                    obj.style.height = "100%";
                                    obj.src = "data:"+safe_type+";charset=utf8;base64,"+b64Data;
                                    obj.sandbox = '';
                                    obj.classList.add("cg-borderbox");

                                    cover.appendChild(obj);
                                    media.appendChild(cover);

                                    if (type === "text/markdown") {
                                        var data_obj = {
                                            text: utf8,
                                            mode: "markdown",
                                            context: "none"
                                        }
                                        var json_str = JSON.stringify(data_obj);
                                        xmlhttpPost('https://api.github.com/markdown', json_str,
                                            function(response) {
                                                if (response === false || response === null) return;
                                                var b64 = encode_base64(response);
                                                obj.src = "data:text/html;charset=utf8;base64,"+b64;
                                            }
                                        );
                                    }
                                }

                                msgbody.insertBefore(media, msgspan);
                            }
                        }

                        if (isOverflowed(msgbody)) {
                            msgbody.classList.add("cg-msgbody-tiny");
                        }

                        status  = sprintf(CG_TXT_READ_BLOCKCHAIN_SUCCESS[CG_LANGUAGE], nr);
                        success = true;
                    }
                }

                if (!success) status = sprintf(CG_TXT_MAIN_API_INVALID_RESPONSE[CG_LANGUAGE], CG_READ_APIS[api].domain);
            }

            if (!success) {
                CG_READ_APIS[api].down = true;
                CG_READ_APIS[api].fails++;
                CG_READ_APIS[api].delay = CG_READ_APIS[api].fails * CG_READ_APIS[api].max_delay;
                msgbox.classList.add("cg-msgbox-failed");
                while (msgspan.hasChildNodes()) msgspan.removeChild(msgspan.lastChild);
                msgspan.appendChild(document.createTextNode("("+CG_TXT_READ_DECODING_FAILED[CG_LANGUAGE]+")"));
                CG_DECODE_ATTEMPTS++;
            }
            else if (CG_DECODE_ATTEMPTS > 0 && msgbox.classList.contains("cg-msgbox-failed")) {
                msgbox.classList.remove("cg-msgbox-failed");
            }

            if (success || CG_DECODE_ATTEMPTS >= CG_MAX_ATTEMPTS) {
                CG_DECODING = null;
                CG_DECODE_ATTEMPTS = 0;
            }

            if (success) {
                var msgtxhash_id = "cg-msgtxhash-"+nr;
                var msgtxhash    = document.getElementById(msgtxhash_id);
                msgtxhash.href = sprintf(CG_READ_APIS[api].link, txid);
                CG_READ_APIS[api].fails = 0;
            }

            CG_STATUS.push(status);
        }, (CG_READ_API_OK ? 3000 : 20000)
    );

    return true;
}

function cg_read_extract_blockchaininfo(r) {
    var out_bytes= "";
    var op_return= "";
    var outs = r.out.length;

    for (var j = 0; j < outs; j++) {
        if ("addr" in r.out[j]) {
            out_bytes = out_bytes + Bitcoin.getAddressPayload(r.out[j].addr);
        }
        else if ("script" in r.out[j] && r.out[j].script.length > 4) {
            var OP = r.out[j].script.substr(0, 2);
            if (OP.toUpperCase() === "6A") {
                // OP_RETURN detected
                var hex_body = r.out[j].script.substr(4);
                op_return = op_return + hex2ascii(hex_body);
            }
        }
    }
    return [out_bytes, op_return, r.time];
}

function cg_read_extract_insight(r) {
    var out_bytes= "";
    var op_return= "";
    var outs = r.vout.length;

    for (var j = 0; j < outs; j++) {
        if (!("scriptPubKey" in r.vout[j])) continue;

        if ("hex" in r.vout[j].scriptPubKey
        && r.vout[j].scriptPubKey.hex.length === 50
        && r.vout[j].scriptPubKey.hex.substr( 0,6).toLowerCase() === "76a914"
        && r.vout[j].scriptPubKey.hex.substr(46,4).toLowerCase() === "88ac") {
            out_bytes = out_bytes + hex2ascii(r.vout[j].scriptPubKey.hex.substr(6,40));
        }
        else if ("hex" in r.vout[j].scriptPubKey
        && r.vout[j].scriptPubKey.hex.length === 46
        && r.vout[j].scriptPubKey.hex.substr( 0,4).toLowerCase() === "a914"
        && r.vout[j].scriptPubKey.hex.substr(44,2).toLowerCase() === "87") {
            out_bytes = out_bytes + hex2ascii(r.vout[j].scriptPubKey.hex.substr(4,40));
        }
        else if ("hex" in r.vout[j].scriptPubKey
        && r.vout[j].scriptPubKey.hex.substr( 0,2).toLowerCase() === "6a") {
            op_return = op_return + hex2ascii(r.vout[j].scriptPubKey.hex.substr(2));
        }
        else if ("addresses" in r.vout[j].scriptPubKey
        &&  r.vout[j].scriptPubKey.addresses.length > 0) {
            out_bytes = out_bytes + Bitcoin.getAddressPayload(r.vout[j].scriptPubKey.addresses[0]);
        }
        else if ("asm" in r.vout[j].scriptPubKey
        && r.vout[j].scriptPubKey.asm.substr(0, 10) == "OP_RETURN ") {
            // OP_RETURN detected
            var hex_body = r.vout[j].scriptPubKey.asm.split(" ").pop();
            op_return = op_return + hex2ascii(hex_body);
        }
    }
    var time = null;
    if ("time" in r) time = r.time;
    return [out_bytes, op_return, time];
}

function cg_read_extract_blockchair(r) {
    var out_bytes= "";
    var op_return= "";

    var txid = null;
    for (var key in r.data) {
        if (r.data.hasOwnProperty(key)) {
            txid = key;
            break;
        }
    }
    if (txid === null || (txid+"").length != 64) return null;

    var outs = r.data[txid].decoded_raw_transaction.vout;
    var size = outs.length;

    for (var j = 0; j < size; j++) {
        if (!("scriptPubKey" in outs[j])) continue;

        if ("hex" in outs[j].scriptPubKey
        && outs[j].scriptPubKey.hex.length === 50
        && outs[j].scriptPubKey.hex.substr( 0,6).toLowerCase() === "76a914"
        && outs[j].scriptPubKey.hex.substr(46,4).toLowerCase() === "88ac") {
            out_bytes = out_bytes + hex2ascii(outs[j].scriptPubKey.hex.substr(6,40));
        }
        else if ("hex" in outs[j].scriptPubKey
        && outs[j].scriptPubKey.hex.length === 46
        && outs[j].scriptPubKey.hex.substr( 0,4).toLowerCase() === "a914"
        && outs[j].scriptPubKey.hex.substr(44,2).toLowerCase() === "87") {
            out_bytes = out_bytes + hex2ascii(outs[j].scriptPubKey.hex.substr(4,40));
        }
        else if ("hex" in outs[j].scriptPubKey
        && outs[j].scriptPubKey.hex.substr( 0,2).toLowerCase() === "6a") {
            op_return = op_return + hex2ascii(outs[j].scriptPubKey.hex.substr(2));
        }
        else if ("addresses" in outs[j].scriptPubKey
        &&  outs[j].scriptPubKey.addresses.length > 0) {
            out_bytes = out_bytes + Bitcoin.getAddressPayload(outs[j].scriptPubKey.addresses[0]);
        }
        else if ("asm" in outs[j].scriptPubKey
        && outs[j].scriptPubKey.asm.substr(0, 10) == "OP_RETURN ") {
            // OP_RETURN detected
            var hex_body = outs[j].scriptPubKey.asm.split(" ").pop();
            op_return = op_return + hex2ascii(hex_body);
        }
    }
    var time = null;
    if ("time" in r) time = r.time;
    return [out_bytes, op_return, time];
}

function cg_read_extract_blockchair_dashboard(r) {
    var out_bytes= "";
    var op_return= "";

    var txid = null;
    for (var key in r.data) {
        if (r.data.hasOwnProperty(key)) {
            txid = key;
            break;
        }
    }
    if (txid === null || (txid+"").length != 64) return null;

    var outs = r.data[txid].outputs;
    var size = outs.length;

    for (var j = 0; j < size; j++) {
        if ("script_hex" in outs[j]
        && outs[j].script_hex.length === 50
        && outs[j].script_hex.substr( 0,6).toLowerCase() === "76a914"
        && outs[j].script_hex.substr(46,4).toLowerCase() === "88ac") {
            out_bytes = out_bytes + hex2ascii(outs[j].script_hex.substr(6,40));
        }
        else if ("script_hex" in outs[j]
        && outs[j].script_hex.length === 46
        && outs[j].script_hex.substr( 0,4).toLowerCase() === "a914"
        && outs[j].script_hex.substr(44,2).toLowerCase() === "87") {
            out_bytes = out_bytes + hex2ascii(outs[j].script_hex.substr(4,40));
        }
        else if ("script_hex" in outs[j]
        && outs[j].script_hex.substr( 0,2).toLowerCase() === "6a") {
            op_return = op_return + hex2ascii(outs[j].script_hex.substr(2));
        }
        else if ("recipient" in outs[j]
        &&  outs[j].recipient.length > 0) {
            var addr = outs[j].recipient;
            var base58 = btc_base58(addr);
            if (base58 !== null) {
                out_bytes = out_bytes + Bitcoin.getAddressPayload(base58);
            }
        }
    }

    var time = null;
    if ("transaction" in r.data[txid] && "time" in r.data[txid].transaction) {
        time = new Date(r.data[txid].transaction.time + "Z")/1000;
    }
    return [out_bytes, op_return, time];
}

function cg_read_extract_btc(r) {
    var out_bytes= "";
    var op_return= "";

    var outs = r.data.outputs;
    var size = outs.length;

    for (var j = 0; j < size; j++) {
        if ("script_hex" in outs[j]
        && outs[j].script_hex.length === 50
        && outs[j].script_hex.substr( 0,6).toLowerCase() === "76a914"
        && outs[j].script_hex.substr(46,4).toLowerCase() === "88ac") {
            out_bytes = out_bytes + hex2ascii(outs[j].script_hex.substr(6,40));
        }
        else if ("script_hex" in outs[j]
        && outs[j].script_hex.length === 46
        && outs[j].script_hex.substr( 0,4).toLowerCase() === "a914"
        && outs[j].script_hex.substr(44,2).toLowerCase() === "87") {
            out_bytes = out_bytes + hex2ascii(outs[j].script_hex.substr(4,40));
        }
        else if ("script_hex" in outs[j]
        && outs[j].script_hex.substr( 0,2).toLowerCase() === "6a") {
            op_return = op_return + hex2ascii(outs[j].script_hex.substr(2));
        }
        else if ("addresses" in outs[j]
        &&  outs[j].addresses.length > 0) {
            out_bytes = out_bytes + Bitcoin.getAddressPayload(outs[j].addresses[0]);
        }
        else if ("script_asm" in outs[j]
        && outs[j].script_asm.substr(0, 10) == "OP_RETURN ") {
            // OP_RETURN detected
            var hex_body = outs[j].script_asm.split(" ").pop();
            op_return = op_return + hex2ascii(hex_body);
        }
    }
    var time = null;
    if ("block_time" in r.data) time = r.data.block_time;
    return [out_bytes, op_return, time];
}

function cg_read_extract_blockr(r) {
    var out_bytes= "";
    var op_return= "";

    if ("status" in r && r.status === "success" && "data" in r
    &&  "vouts" in r.data) {
        var outs = r.data.vouts.length;

        for (var j = 0; j < outs; j++) {
            if (!("address" in r.data.vouts[j])) continue;
            if (r.data.vouts[j].address === "NONSTANDARD") {
                if ("extras" in r.data.vouts[j]
                &&  "asm" in r.data.vouts[j].extras
                && r.data.vouts[j].extras.asm.substr(0, 10) == "OP_RETURN ") {
                    // OP_RETURN detected
                    var hex_body = r.data.vouts[j].extras.asm.substr(10);
                    op_return = op_return + hex2ascii(hex_body);
                }
                continue;
            }

            out_bytes = out_bytes + Bitcoin.getAddressPayload(r.data.vouts[j].address);
        }
    }
    else return null;

    var timestamp = new Date(r.data.time_utc + "Z")/1000;
    return [out_bytes, op_return, timestamp];
}

function cg_read_resolve_filter() {
    if (CG_CONSTANTS === null) return;

    var txs = [];

    for (var txid in CG_READ_FILTER_TXS) {
        if (txs.length + 1 > CG_CONSTANTS.TXS_PER_QUERY) break;
        if (CG_READ_FILTER_TXS.hasOwnProperty(txid)) {
            if (CG_READ_FILTER_TXS[txid] === true) {
                txs.push(txid);
            }
        }
    }

    var data_obj = {
        txids: txs
    }
    var json_str = encodeURIComponent(JSON.stringify(data_obj));

    CG_STATUS.push(CG_TXT_READ_LOADING_GRAFFITI[CG_LANGUAGE]);

    // Make sure we aren't called automatically again before the request is done
    CG_READ_JOBS["cg_read_resolve_filter"] = -1;

    xmlhttpPost(CG_API, 'fun=get_msg_metadata&data='+json_str,
        function(response) {
            CG_READ_JOBS["cg_read_resolve_filter"] = 10;

            var status = "???";
                 if (response === false) status = CG_TXT_READ_LOADING_ERROR[CG_LANGUAGE];
            else if (response === null ) status = CG_TXT_READ_LOADING_TIMEOUT[CG_LANGUAGE];
            else {
                delete CG_READ_JOBS["cg_read_resolve_filter"];

                json = JSON.parse(response);
                if ("payload" in json) {
                    var count = 0;
                    if (CG_READ_FILTER_TXS !== null) {
                        var sz = Math.min(json.payload.length, txs.length);
                        for (var i=0; i<sz; ++i) {
                            CG_READ_FILTER_TXS[txs[i]] = json.payload[i];
                            if (json.payload[i] !== null) count ++;
                        }
                    }
                    status = sprintf(CG_TXT_READ_NUMBER_OF_GRAFFITI_LOADED[CG_LANGUAGE], count);
                }
                else {
                    status = CG_TXT_READ_INVALID_RESPONSE[CG_LANGUAGE];
                    cg_handle_error(json);
                }

                for (var txid in CG_READ_FILTER_TXS) {
                    if (CG_READ_FILTER_TXS.hasOwnProperty(txid)) {
                        if (CG_READ_FILTER_TXS[txid] === true) {
                            // Some still remain unresolved.
                            CG_READ_JOBS["cg_read_resolve_filter"] = 3;
                            break;
                        }
                    }
                }

                if ("cg_read_resolve_filter" in CG_READ_JOBS == false) {
                    // We are finished resolving filters.

                    var newest = null;
                    var oldest = null;
                    for (var txid in CG_READ_FILTER_TXS) {
                        if (CG_READ_FILTER_TXS.hasOwnProperty(txid)) {
                            if (CG_READ_FILTER_TXS[txid] === true
                            ||  CG_READ_FILTER_TXS[txid] === null
                            ||  CG_READ_FILTER_TXS[txid] === false) continue;

                            var nr = parseInt(CG_READ_FILTER_TXS[txid].nr, 10);

                            if (newest === null) newest = nr;
                            if (oldest === null) oldest = nr;

                            if (nr < oldest) oldest = nr;
                            if (nr > newest) newest = nr;

                            var obj = {
                                type:  CG_READ_FILTER_TXS[txid].type,
                                fsize: CG_READ_FILTER_TXS[txid].fsize,
                                txid:  txid
                            };

                            var key = nr.toString(10);
                            if (key in CG_GRAFFITI === false) {
                                CG_GRAFFITI_NRS.unshift(nr);
                                CG_GRAFFITI_OLDS.push(nr);
                            }
                            CG_GRAFFITI[key] = obj;
                        }
                    }

                    CG_NEWEST_TX_NR = newest !== null ? newest.toString(10) : null;
                    CG_OLDEST_TX_NR = oldest !== null ? oldest.toString(10) : null;

                    var tab = document.getElementById("cg-tab-read");
                    if (tab.hasChildNodes()) {
                        tab.lastChild.classList.add("cg-disappear");
                        setTimeout(function(){
                            while (tab.hasChildNodes()) {
                                tab.removeChild(tab.lastChild);
                            }
                            tab.classList.remove("cg-read-tab-premature");
                            tab.classList.add("cg-read-tab");
                            tab.classList.add("cg-appear");
                        }, 500);
                    }
                }
            }

            if (status !== null) CG_STATUS.push(status);
        }
    );

    return true;
}

function cg_read_get_filter() {
    if (CG_CONSTANTS === null) return false;
    if (CG_READ_FILTER_ADDR === null) {
        CG_READ_JOBS["cg_read_get_latest"] = 1;
        return true;
    }

    var apis = [];
    var api = null;
    for (var i=0, sz = CG_READ_APIS.length; i<sz; i++) {
        if ("request_addr" in CG_READ_APIS[i] == false) continue;
        if (CG_READ_APIS[i].delay ===  0) apis.push(i);
    }

    if (apis.length > 0) {
        apis = shuffle(apis);
        api = apis[0];
    }

    if (api === null) return false;

    var key = (CG_READ_FILTER_KEY !== null ? CG_READ_FILTER_KEY : CG_READ_FILTER_ADDR);
    key = key.substring(0, 64);
    if (key !== CG_READ_FILTER_KEY) key = key+"...";

    CG_STATUS.push(sprintf(CG_TXT_READ_LOADING_FILTER[CG_LANGUAGE], key));

    CG_READ_APIS[api].delay = -1;
    xmlhttpGet(sprintf(CG_READ_APIS[api].request_addr, CG_READ_FILTER_ADDR), '',
        function(response) {
            CG_READ_APIS[api].delay = CG_READ_APIS[api].max_delay;
            CG_READ_APIS[api].down  = false;

            var status = "???";
            var success = false;

                 if (response === false) status = CG_TXT_READ_BLOCKCHAIN_ERROR[CG_LANGUAGE];
            else if (response === null ) status = CG_TXT_READ_BLOCKCHAIN_TIMEOUT[CG_LANGUAGE];
            else {
                var json = JSON.parse(response);
                if ("transactions" in json) {
                    var outs = json.transactions.length;
                    CG_READ_FILTER_TXS = {};
                    for (var j = 0; j < outs; j++) {
                        CG_READ_FILTER_TXS[json.transactions[j]] = true;
                    }
                    success = true;
                    status  = null;
                }
                else status = CG_TXT_READ_BLOCKCHAIN_INVALID[CG_LANGUAGE];
            }

            if (success) CG_READ_JOBS["cg_read_resolve_filter"] = 1;
            else {
                CG_READ_APIS[api].down = true;
                CG_READ_APIS[api].fails++;
                CG_READ_APIS[api].delay = CG_READ_APIS[api].fails * CG_READ_APIS[api].max_delay;

                CG_READ_JOBS["cg_read_get_filter"] = 1*CG_READ_PPS;
            }

            if (status !== null) CG_STATUS.push(status);
        }
    );

    return true;
}

function cg_read_get_latest() {
    if (CG_CONSTANTS === null) return false;

    var data_obj = {
        nr: CG_TX_NR,
        count: "1",
        back: null
    }

    if (CG_READ_MIMETYPE !== null) data_obj["mimetype"] = CG_READ_MIMETYPE;

    var json_str = encodeURIComponent(JSON.stringify(data_obj));

    CG_STATUS.push(CG_TXT_READ_LOADING_GRAFFITI[CG_LANGUAGE]);

    xmlhttpPost(CG_API, 'fun=get_btc_graffiti&data='+json_str,
        function(response) {
            var status = "???";
                 if (response === false) status = CG_TXT_READ_LOADING_ERROR[CG_LANGUAGE];
            else if (response === null ) status = CG_TXT_READ_LOADING_TIMEOUT[CG_LANGUAGE];
            else {
                json = JSON.parse(response);
                if ("txs" in json) {
                    if (json.txs.length > 0) {
                        CG_NEWEST_TX_NR = json.txs[0].nr;
                        CG_OLDEST_TX_NR = CG_NEWEST_TX_NR;

                        if (CG_NEWEST_TX_NR !== null) {
                            var obj = {
                                type:   json.txs[0].type,
                                fsize:  json.txs[0].fsize,
                                txid:   json.txs[0].txid,
                                amount: json.txs[0].amount
                            };

                            var key = parseInt(json.txs[0].nr, 10);
                            if (CG_READ_FILTER_TXS === null || obj.txid in CG_READ_FILTER_TXS) {
                                if (key in CG_GRAFFITI === false) {
                                    CG_GRAFFITI_NRS.push(key);
                                    CG_GRAFFITI_NEWS.push(key);
                                }
                                CG_GRAFFITI[key] = obj;
                            }

                            status = sprintf(CG_TXT_READ_GRAFFITI_LOADED[CG_LANGUAGE], CG_NEWEST_TX_NR);

                            var tab = document.getElementById("cg-tab-read");
                            if (tab.hasChildNodes()) {
                                tab.lastChild.classList.add("cg-disappear");
                                setTimeout(function(){
                                    while (tab.hasChildNodes()) {
                                        tab.removeChild(tab.lastChild);
                                    }
                                    tab.classList.remove("cg-read-tab-premature");
                                    tab.classList.add("cg-read-tab");
                                    tab.classList.add("cg-appear");
                                }, 500);
                            }
                        }
                        else status = CG_TXT_READ_INVALID_RESPONSE[CG_LANGUAGE];
                    }
                    else {
                        if (CG_TX_NR !== null) {
                            status = sprintf(CG_TXT_READ_GRAFFITI_NOT_FOUND[CG_LANGUAGE], CG_TX_NR);
                            CG_TX_NR = null;
                        }
                        else status = CG_TXT_READ_NO_GRAFFITI[CG_LANGUAGE];
                    }
                }
                else {
                    status = CG_TXT_READ_INVALID_RESPONSE[CG_LANGUAGE];
                    cg_handle_error(json);
                }
            }

            CG_STATUS.push(status);

            if (CG_NEWEST_TX_NR === null) CG_READ_JOBS["cg_read_get_latest"] = 10*CG_READ_PPS;
        }
    );

    return true;
}

function cg_read_load_new_txs() {
    if (CG_NEWEST_TX_NR === null || CG_READ_FILTER_TXS !== null) return false;

    var fun = "get_btc_graffiti";
    var data_obj = {
        nr: CG_NEWEST_TX_NR.toString(10),
        count: Math.min(CG_CONSTANTS.TXS_PER_QUERY, 10).toString(10),
        back: "0"
    }

    if (CG_READ_MIMETYPE !== null) data_obj["mimetype"] = CG_READ_MIMETYPE;

    if (Math.random() < 0.5) {
        fun = "get_btc_donations";
        var sz = CG_GRAFFITI_NRS.length;
        var nr = CG_NEWEST_TX_NR;
        for (var i=0; i<sz; ++i) {
            nr = Math.max(nr, CG_GRAFFITI_NRS[i]);
        }
        data_obj.nr = nr.toString(10);
        data_obj.count = "4";
    }

    var json_str = encodeURIComponent(JSON.stringify(data_obj));

    CG_STATUS.push(CG_TXT_READ_LOADING_NEW_GRAFFITI[CG_LANGUAGE]);

    // Make sure we aren't called automatically again before the request is done
    CG_READ_JOBS["cg_read_load_new_txs"] = -1;

    xmlhttpPost(CG_API, 'fun='+fun+'&data='+json_str,
        function(response) {
            delete CG_READ_JOBS["cg_read_load_new_txs"];
            var status = "???";

                 if (response === false) status = CG_TXT_READ_LOADING_NEW_ERROR[CG_LANGUAGE];
            else if (response === null ) status = CG_TXT_READ_LOADING_NEW_TIMEOUT[CG_LANGUAGE];
            else {
                var count = 0;
                var delay = true;
                json = JSON.parse(response);
                if ("txs" in json) {
                    if (json.txs.length > 0) {
                        if (fun === "get_btc_graffiti") {
                            CG_NEWEST_TX_NR = json.txs[json.txs.length-1].nr;
                        }

                        var sz = json.txs.length;
                        for (var i = 0; i < sz; i++) {
                            var obj = {
                                type:  json.txs[i].type,
                                fsize: json.txs[i].fsize,
                                txid:  json.txs[i].txid,
                                amount:json.txs[i].amount,
                                fun:   fun
                            };
                            if (CG_READ_FILTER_TXS === null || obj.txid in CG_READ_FILTER_TXS) {
                                var key = parseInt(json.txs[i].nr, 10);
                                if (key in CG_GRAFFITI === false) {
                                    CG_GRAFFITI_NRS.push(key);
                                    CG_GRAFFITI_NEWS.push(key);
                                    count++;
                                }
                                CG_GRAFFITI[key] = obj;
                                delay = false;
                            }
                        }
                    }

                    if (json.txs.length <= 1 || (delay && count > 0)) CG_READ_JOBS["cg_read_load_new_txs"] = 30*CG_READ_PPS;

                    status = sprintf(CG_TXT_READ_NEW_GRAFFITI_LOADED[CG_LANGUAGE], count, CG_GRAFFITI_NRS.length);
                }
                else {
                    cg_handle_error(json);
                    status = CG_TXT_READ_LOADING_NEW_ERROR[CG_LANGUAGE];
                }
            }

            CG_STATUS.push(status);
        }
    );

    return true;
}

function cg_read_load_old_txs() {
    if (CG_OLDEST_TX_NR === null  || CG_READ_FILTER_TXS !== null) return false;

    var fun = "get_btc_graffiti";
    var data_obj = {
        nr: CG_OLDEST_TX_NR.toString(10),
        count: Math.min(CG_CONSTANTS.TXS_PER_QUERY, 10).toString(10),
        back: "1"
    }

    if (CG_READ_MIMETYPE !== null) data_obj["mimetype"] = CG_READ_MIMETYPE;

    if (CG_GRAFFITI_NRS.length === 1 || Math.random() < 0.5) {
        // If this is the first time we are loading old TXs then make sure we
        // always show the last 10 donations before displaying other messages.
        // The reasoning behind this is to incentivize making a donation and to
        // always include quality content such as pictures on the "front page"
        // of the site to give a better first impression.
        fun = "get_btc_donations";
        if (CG_GRAFFITI_NRS.length === 1) data_obj.count = "10";
        else {
            var sz = CG_GRAFFITI_NRS.length;
            var nr = CG_OLDEST_TX_NR;
            for (var i=0; i<sz; ++i) {
                nr = Math.min(nr, CG_GRAFFITI_NRS[i]);
            }
            data_obj.nr = nr.toString(10);
            data_obj.count = "4";
        }
    }

    var json_str = encodeURIComponent(JSON.stringify(data_obj));

    CG_STATUS.push(CG_TXT_READ_LOADING_OLD_GRAFFITI[CG_LANGUAGE]);

    // Make sure we aren't called automatically again before the request is done
    CG_READ_JOBS["cg_read_load_old_txs"] = -1;

    xmlhttpPost(CG_API, 'fun='+fun+'&data='+json_str,
        function(response) {
            delete CG_READ_JOBS["cg_read_load_old_txs"];
            var status = "???";

                 if (response === false) status = CG_TXT_READ_LOADING_OLD_ERROR[CG_LANGUAGE];
            else if (response === null ) status = CG_TXT_READ_LOADING_OLD_TIMEOUT[CG_LANGUAGE];
            else {
                var count = 0;
                var delay = true;
                json = JSON.parse(response);
                if ("txs" in json) {
                    if (json.txs.length > 0) {
                        if (fun === "get_btc_graffiti") {
                            CG_OLDEST_TX_NR = json.txs[json.txs.length-1].nr;
                        }

                        var sz = json.txs.length;
                        for (var i = 0; i < sz; i++) {
                            var obj = {
                                type:   json.txs[i].type,
                                fsize:  json.txs[i].fsize,
                                txid:   json.txs[i].txid,
                                amount: json.txs[i].amount,
                                fun:    fun
                            };
                            if (CG_READ_FILTER_TXS === null || obj.txid in CG_READ_FILTER_TXS) {
                                var key = parseInt(json.txs[i].nr, 10);
                                if (key in CG_GRAFFITI === false) {
                                    CG_GRAFFITI_NRS.unshift(key);
                                    CG_GRAFFITI_OLDS.push(key);
                                    count++;
                                }
                                CG_GRAFFITI[key] = obj;
                                delay = false;
                            }
                        }
                    }
                    if (json.txs.length <= 1 || (delay && count > 0)) CG_READ_JOBS["cg_read_load_old_txs"] = 30*CG_READ_PPS;

                    status = sprintf(CG_TXT_READ_OLD_GRAFFITI_LOADED[CG_LANGUAGE], count, CG_GRAFFITI_NRS.length);
                }
                else {
                    cg_handle_error(json);
                    status = CG_TXT_READ_LOADING_OLD_ERROR[CG_LANGUAGE];
                }
            }

            CG_STATUS.push(status);
        }
    );

    return true;
}

function cg_read_delete_graffiti(div, top) {
    //var max_width = div.clientWidth;
    //var del_width = 0;

    var execute = false;
    to_delete = [];

    var children = div.children;

    var i_val = 0;
    var i_mod = 1;
    var i_end = children.length;

    if (!top) {
        i_val = children.length-1;
        i_mod = -1;
        i_end = -1;
    }

    var row_y = null;
    var row_h = null;

    for (var i = i_val; i !== i_end; i += i_mod) {
        var child = children[i];

        if (child.classList.contains('cg-read-loadingbox')) continue;

        if (row_y !== null) {
            if (top) {
                if (child.offsetTop+child.offsetHeight > row_y) {
                    if (child.offsetTop < row_y) {
                        row_y = child.offsetTop+child.offsetHeight;
                        row_h = child.offsetHeight;
                    }
                    else {execute = true; break;}
                }
            }
            else {
                if (child.offsetTop < row_y) {
                    if (child.offsetTop+child.offsetHeight > row_y+row_h) {
                        row_y = child.offsetTop;
                        row_h = child.offsetHeight;
                    }
                    else {execute = true; break;}
                }
            }
        }
        else {
            row_y = (top ? child.offsetTop+child.offsetHeight : child.offsetTop);
            row_h = child.offsetHeight;
        }

        to_delete.push(child);
    }

    if (execute) {
        var sz = to_delete.length;

        for (var i = 0; i<sz; i++) {
            var child_id = to_delete[i].id;

            while (CG_GRAFFITI_NRS.length > 0) {
                var nr = (top ? CG_GRAFFITI_NRS.pop() : CG_GRAFFITI_NRS.shift());

                var nr_key = nr.toString(10);
                if (nr_key in CG_GRAFFITI) delete CG_GRAFFITI[nr_key];

                if (top) CG_NEWEST_TX_NR = nr_key;
                else     CG_OLDEST_TX_NR = nr_key;

                if (child_id === "cg-msgbox-"+nr_key) break;
            }

            div.removeChild(to_delete[i]);
        }
    }
}

function cg_read_delete_graffiti_top(div) {
    return cg_read_delete_graffiti(div, true);
}

function cg_read_delete_graffiti_bottom(div) {
    return cg_read_delete_graffiti(div, false);
}

function cg_get_tx_nr() {
    return CG_TX_NR;
}

function cg_set_tx_nr(value) {
    CG_TX_NR = value;
}

function cg_read_create_graffiti(div, nr, append) {
    if (document.getElementById("cg-msgbox-"+nr) !== null
    ||  nr in CG_GRAFFITI === false) return;

    var t = CG_GRAFFITI[nr];

    var msgbox     = document.createElement("DIV");
    var msgheader  = document.createElement("DIV");
    var msgheaderL = document.createElement("DIV");
    var msgheaderR = document.createElement("DIV");
    var msgbody    = document.createElement("PRE");
    var msgfooter  = document.createElement("DIV");
    var msgfooterL = document.createElement("DIV");
    var msgfooterR = document.createElement("DIV");

    msgheaderL.appendChild(document.createElement("span"));
    msgfooterR.appendChild(document.createElement("span"));

    var t_nr = document.createTextNode("#"+nr);
    var a_nr = document.createElement("a");
    a_nr.appendChild(t_nr);
    a_nr.title = CG_TXT_READ_LINK_TO_THIS_MSG[CG_LANGUAGE];
    a_nr.href  = "#"+t.txid;
    if ("type" in CG_GRAFFITI[nr]) {
        for (var key in CG_VIEW_TYPES) {
            if (CG_VIEW_TYPES.hasOwnProperty(key)) {
                if (CG_VIEW_TYPES[key] === CG_GRAFFITI[nr].type) {
                    if (key.length > 0) a_nr.href += "."+key;
                    break;
                }
            }
        }
    }

    a_nr.id    = "cg-msgnr-"+nr;
    a_nr.onclick=function(){
        var selected = cg_get_tx_nr();
        var mbx = null;
        if (selected !== null) {
            // Some messsage has been already selected, deselect it first.
            mbx = document.getElementById("cg-msgbox-"+selected);
            if (mbx !== null) mbx.classList.remove("cg-msgbox-selected");

            var old_msgbody_id = "cg-msgbody-"+selected; // Find its message body.
            var old_msgbody = document.getElementById(old_msgbody_id);
            if (old_msgbody !== null && old_msgbody.classList.contains('cg-msgbody-overflowed')) {
                // Restore the message body's onclick event.
                old_msgbody.classList.add("cg-msgbody-clickable");
                old_msgbody.onclick = function(){
                    var a_nr = document.getElementById("cg-msgnr-"+selected);
                    if (a_nr !== null) a_nr.click();
                    return true;
                };
            }
        }
        if (selected === nr.toString(10)) {
            // Click was made on ourselves, quit after having deselected ourselves.
            cg_set_tx_nr(null);
            return true;
        }
        cg_set_tx_nr(nr.toString(10)); // Set the new selected message.
        mbx = document.getElementById("cg-msgbox-"+cg_get_tx_nr());
        if (mbx !== null) mbx.classList.add("cg-msgbox-selected");

        var msgbody_id = "cg-msgbody-"+cg_get_tx_nr();
        var msgbody = document.getElementById(msgbody_id);
        if (msgbody !== null && msgbody.classList.contains('cg-msgbody-overflowed')) {
            msgbody.classList.remove("cg-msgbody-clickable");
            msgbody.onclick = "javascript:void(0)";
        }

        return true;
    };
    //a_nr.onclick=function(){fade_out(); setTimeout(function(){location.reload();}, 500); return true;};

    msgheaderL.appendChild(a_nr);

    if ("fun" in t && t.fun === "get_btc_donations") {
        var tx_featured = document.createElement("span");
        tx_featured.appendChild(document.createTextNode("🌟"));
        tx_featured.title = CG_TXT_READ_MSG_FLAG_FEATURED[CG_LANGUAGE];
        tx_featured.classList.add("cg-msgbox-stamp");
        msgheaderL.appendChild(tx_featured);
    }

    msgheaderR.appendChild(document.createTextNode(""));

    var t_txid = document.createTextNode(t.txid);
    var a_txid = document.createElement("a"); a_txid.appendChild(t_txid);
    a_txid.id  = "cg-msgtxhash-"+nr;
    a_txid.title = CG_TXT_READ_TRANSACTION_DETAILS[CG_LANGUAGE];
    a_txid.href  = sprintf(CG_READ_APIS[CG_READ_API].link, t.txid);
    a_txid.target= "_blank";

    var span = document.createElement('span');
    span.appendChild(document.createTextNode("("+CG_TXT_READ_MSG_NOT_DECODED_YET[CG_LANGUAGE]+")"));
    span.id="cg-msgbox-"+nr+"-span";
    span.classList.add("cg-msgspan");

    msgheader.appendChild(msgheaderL);
    msgheader.appendChild(msgheaderR);
    msgbody.appendChild(span);
    msgfooterL.appendChild(a_txid)

    if ("amount" in t && t.amount !== null) {
        var amount = parseInt(t.amount, 10);
        if (amount > 0) msgbox.classList.add("cg-msgbox-ours");

        var tx_stamp1 = document.createElement("img");
        tx_stamp1.src = document.getElementById("gfx_icon").src;
        tx_stamp1.title = CG_TXT_READ_MSG_FLAG_CRYPTOGRAFFITI[CG_LANGUAGE];
        tx_stamp1.classList.add("cg-msgbox-stamp");
        tx_stamp1.classList.add("cg-stamp-ours");

        var tx_stamp2 = document.createElement("span");
        tx_stamp2.appendChild(document.createTextNode("🔒"));
        tx_stamp2.title = CG_TXT_READ_MSG_FLAG_PERMANENT[CG_LANGUAGE];
        tx_stamp2.classList.add("cg-msgbox-stamp");
        tx_stamp2.classList.add("cg-stamp-permanent");

        var tx_stamp3 = document.createElement("span");
        tx_stamp3.appendChild(document.createTextNode("🔓"));
        tx_stamp3.title = CG_TXT_READ_MSG_FLAG_PRUNABLE[CG_LANGUAGE];
        tx_stamp3.classList.add("cg-msgbox-stamp");
        tx_stamp3.classList.add("cg-stamp-prunable");

        msgfooterR.appendChild(tx_stamp3);
        msgfooterR.appendChild(tx_stamp2);
        msgfooterR.appendChild(tx_stamp1);
    }

    msgfooter.appendChild(msgfooterL);
    msgfooter.appendChild(msgfooterR);

    msgbox.appendChild(msgheader);
    msgbox.appendChild(msgbody);
    msgbox.appendChild(msgfooter);

    msgheader.classList.add("cg-msgheader");
    msgheaderL.classList.add("cg-msgheader-left");
    msgheaderR.classList.add("cg-msgheader-right");
    msgfooter.classList.add("cg-msgfooter");
    msgfooterL.classList.add("cg-msgfooter-left");
    msgfooterR.classList.add("cg-msgfooter-right");
    msgbody.classList.add("cg-msgbody");
    msgbody.classList.add("cg-read-msgbody");
    msgbox.classList.add("cg-msgbox");
    msgbox.classList.add("cg-borderbox");
    msgbox.classList.add("cg-hidden");

    if (nr.toString(10) === CG_TX_NR) msgbox.classList.add("cg-msgbox-selected");

    msgbox.id = "cg-msgbox-"+nr;
    msgbody.id = "cg-msgbody-"+nr;
    msgheaderR.id = "cg-msgheader-right-"+nr;
    msgbox.classList.add("cg-msgbox-premature");
    t.premature = true;

    if (append) div.appendChild(msgbox);
    else        div.insertBefore(msgbox, div.firstChild);
}

function cg_read_scrolled_top(div) {
    if (Math.floor(div.scrollTop) <= 1) return true;
    return false;
}

function cg_read_scrolled_bottom(div) {
    if (Math.ceil(div.scrollTop)+1 >= (div.scrollHeight - div.clientHeight)) {
        return true;
    }
    return false;
}

function cg_read_scrolled_near_bottom(div) {
    if ((Math.ceil(div.scrollTop)+1+div.offsetHeight/2) > (div.scrollHeight/2)) {
        return true;
    }
    return false;
}

function cg_read_scroll_visible(div) {
    return div.offsetHeight / div.scrollHeight;
}

function cg_read_scroll_top(div, now) {
    if (cg_read_scrolled_top(div)) return;
    now = typeof now !== 'undefined' ? now : false;
    if (now) {
        div.scrollTop = 0;
        return;
    }
    scrollTo(div, 0, CG_SCROLL_DELAY);
}

function cg_read_scroll_bottom(div, now) {
    if (cg_read_scrolled_bottom(div)) return;
    now = typeof now !== 'undefined' ? now : false;
    if (now) {
        div.scrollTop = div.scrollHeight;
        return;
    }
    scrollTo(div, div.scrollHeight - div.clientHeight, CG_SCROLL_DELAY);
}

function cg_read_mature_top(div) {
    return cg_read_mature(div, false);
}

function cg_read_mature_bottom(div) {
    return cg_read_mature(div, true);
}

function cg_read_mature(tab, near_bottom) {
    var children = tab.children;

    var i_val = 0;
    var i_mod = 1;
    var i_end = children.length;

    if (near_bottom) {
        i_val = children.length-1;
        i_mod = -1;
        i_end = -1;
    }

    var top_bars = 0;
    var bottom_bars = 0;
    var loadingbars = [];
    var list = [];
    var mature_found = false;

    for (var i = i_val; i !== i_end; i += i_mod) {
        var child = children[i];

        if (child.classList.contains('cg-read-loadingbox-top'))    top_bars++;
        if (child.classList.contains('cg-read-loadingbox-bottom')) bottom_bars++;

        if (child.classList.contains('cg-read-loadingbox-'+(near_bottom ? 'bottom' : 'top'))) {
            loadingbars.push(child);
            continue;
        }

        if (mature_found) continue;

        if (child.classList.contains('cg-msgbox-premature')
        && (child.classList.contains('cg-msgbox-decoded')
         || child.classList.contains('cg-msgbox-failed'))) {
            list.unshift(child);
        }
        else if (!child.classList.contains('cg-msgbox-premature')) {
            mature_found = true;
        }
    }

    var row = [];
    var row_width = 0;
    var style = window.getComputedStyle(tab, null);
    var padding = parseFloat(style.getPropertyValue("padding-left")) + parseFloat(style.getPropertyValue("padding-right"));
    var max_width = tab.clientWidth - padding;

    var sz = list.length;
    var mature = false;
    for (var i = 0; i < sz; i++) {
        var box = list[i];
        if ((row_width + box.offsetWidth > max_width && row_width !== 0)) {
            mature = true;
            break;
        }
        row_width += box.offsetWidth;
        row.push(box);

        if (box.classList.contains('cg-msgbox-selected')
        || (top_bars === 0 && bottom_bars === 0)) {
            mature   = true; // This is required when the user enters the site from a link referencing
            cg_sfx_spray();  // a particular message. We also display content ASAP when there is no
            break;           // decoded content displayed.
        }

        if (i+1 == sz) {
            if (CG_IMMATURE_DIV === null) {
                CG_IMMATURE_DIV = box.id;
                CG_IMMATURE_TIME= 0;
                CG_IMMATURE_BOTTOM = near_bottom;
            }
            else if (document.getElementById(CG_IMMATURE_DIV) === null) {
                CG_IMMATURE_DIV = null;
            }
            else if (near_bottom === CG_IMMATURE_BOTTOM) {
                CG_IMMATURE_TIME++;
                if (CG_IMMATURE_TIME >= 10*CG_READ_PPS) {
                    CG_IMMATURE_DIV = null;
                    mature = true;
                    if (!near_bottom) cg_sfx_spray();
                    break;
                }
            }
        }
    }

    if (!mature) {
        if (CG_IMMATURE_BOTTOM == near_bottom) {
            if (CG_IMMATURE_ROW < row_width) CG_IMMATURE_TIME = 0;
            CG_IMMATURE_ROW = row_width;
        }

        if (loadingbars.length > 0) {
            var barbox = loadingbars[0];
            if (barbox.hasChildNodes()) {
                var bar = barbox.children[0].children[0];
                var p = Math.min(Math.round(100.0 * row_width / max_width), 100).toString(10);
                bar.style.width = p+"%";
            }
        }

        return false;
    }

    sz = row.length;
    for (var i = 0; i < sz; i++) {
        cg_read_msgbox_mature(row[i].id);
        if (CG_IMMATURE_DIV === row[i].id) CG_IMMATURE_DIV = null;
    }

    // Create initial loading bars:
    if (top_bars === 0 && bottom_bars === 0 && sz > 0) {
        cg_read_create_loadingbar(tab, true,  near_bottom ? row[   0] : row[sz-1]);
        cg_read_create_loadingbar(tab, false, near_bottom ? row[sz-1] : row[   0]);
    }
    else if (sz > 0) {
        // Some loading bars already exist
        cg_read_create_loadingbar(tab, near_bottom, row[sz-1]);
    }

    var first_offscreen = false;
    sz = loadingbars.length;
    for (var i = 0; i < sz; i++) {
        if (loadingbars[i].classList.contains('cg-read-loadingbox-close')) {
            //if (i == sz-1) {
                if (loadingbars[i].offsetTop+loadingbars[i].offsetHeight < tab.scrollTop
                ||  loadingbars[i].offsetTop > tab.scrollTop + tab.clientHeight) {
                    if (!first_offscreen) first_offscreen = true;
                    else tab.removeChild(loadingbars[i]);
                }
            //}
        }
        else {
            loadingbars[i].classList.remove("cg-appear");
            loadingbars[i].classList.add('cg-read-loadingbox-close');
            loadingbars[i].classList.add('cg-disappear');
            if (loadingbars.length > 0) {
                var barbox = loadingbars[0];
                if (barbox.hasChildNodes()) {
                    var bar = barbox.children[0].children[0];
                    bar.style.width = "100%";
                    CG_READ_COOLDOWN = 1*CG_READ_PPS;
                }
            }
        }
    }

    return true;
}

function cg_read_create_loadingbar(tab, near_bottom, last) {
    last = typeof last !== 'undefined' ? last : null;
    var loadingbox = document.createElement("DIV");
    var loadingbar = document.createElement("DIV");
    var loadingbg  = document.createElement("DIV");

    loadingbox.classList.add("cg-read-loadingbox");
    if (near_bottom) loadingbox.classList.add("cg-read-loadingbox-bottom");
    else             loadingbox.classList.add("cg-read-loadingbox-top");

    loadingbg.classList.add("cg-read-loadingbar-bg");
    loadingbar.classList.add("cg-read-loadingbar");
    loadingbox.classList.add("cg-appear");
    loadingbg.appendChild(loadingbar);
    loadingbox.appendChild(loadingbg);

    if (last != null) {
        if (near_bottom) {
            if (tab.lastChild === last) tab.appendChild(loadingbox);
            else tab.insertBefore(loadingbox, last.nextSibling);
        }
        else tab.insertBefore(loadingbox, last);
        return;
    }

    if (near_bottom) tab.appendChild(loadingbox);
    else             tab.insertBefore(loadingbox, tab.firstChild);

}

function cg_read_msgbox_mature(msgbox_id) {
    var div = document.getElementById(msgbox_id);
    if (div === null) return;

    div.classList.remove('cg-msgbox-premature');

    var msgbox = document.getElementById(msgbox_id);
    if (msgbox === null) return;

    setTimeout(function() {
        msgbox.classList.add("cg-appear");
        msgbox.classList.remove("cg-hidden");
    }, 50+Math.floor((Math.random() * 150) + 1));

    var pieces = msgbox_id.split("-");
    var nr = parseInt(pieces.pop(), 10);

    if (nr in CG_GRAFFITI !== false) {
        var t = CG_GRAFFITI[nr];
        t.premature = false;
    }
    else alert(sprintf(CG_TXT_READ_ERROR_2[CG_LANGUAGE], nr.toString(10)));

    var msgbody_id = "cg-msgbody-"+nr;
    var msgbody    = document.getElementById(msgbody_id);

    if (msgbody !== null && isOverflowed(msgbody)) {
        msgbody.classList.add("cg-msgbody-overflowed");
        if (!msgbox.classList.contains('cg-msgbox-selected')) {
            msgbody.classList.add("cg-msgbody-clickable");
        }

        if (CG_TX_NR !== nr.toString(10)) {
            msgbody.onclick = function(){
                var a_nr = document.getElementById("cg-msgnr-"+nr);
                if (a_nr !== null) a_nr.click();
                return true;
            };
        }

        scrollTo(msgbody, msgbody.scrollHeight - msgbody.clientHeight, 5000);
    }
}

function smoothScroll(div_id, by, steps, delay, key) {
    var div = document.getElementById(div_id);
    if (div === null) return;

    if (div.classList.contains('cg-read-tab')) CG_READ_SCROLL_KEY = key;
    else {
        var tab = document.getElementById("cg-tab-read");
        if (tab !== null) {
            //alert(div.offsetTop+">"+tab.scrollTop+" + "+tab.scrollHeight);
            if (div.offsetTop+div.offsetHeight < tab.scrollTop
            ||  div.offsetTop > tab.scrollTop + tab.clientHeight) {
                if (CG_READ_SCROLL_KEY === key) CG_READ_SCROLL_KEY = null;

                setTimeout(function(){
                    smoothScroll(div_id, by, steps, delay, key);
                }, 1000+Math.floor((Math.random() * 1000) + 1) );

                return;
            }
        }
    }

    if (CG_READ_SCROLL_KEY === null) {
        CG_READ_SCROLL_KEY = key;
    }
    else if (CG_READ_SCROLL_KEY !== key) {
        setTimeout(function(){
            smoothScroll(div_id, by, steps, delay, key);
        }, 1000+Math.floor((Math.random() * 1000) + 1) );
        return;
    }

    if (CG_SCROLL_KEY && CG_SCROLL_FIXED && div.classList.contains('cg-read-tab')) {
        CG_READ_SCROLL_KEY = null;
        return;
    }

    var before = div.scrollTop;
    div.scrollTop += (by < 0.0 ? -Math.ceil(Math.abs(by)) : Math.ceil(by));
    if (before === div.scrollTop) {
        CG_READ_SCROLL_KEY = null;
        return;
    }

    steps--;
    if (steps < 0) {
        CG_READ_SCROLL_KEY = null;
        return;
    }

    setTimeout(function(){
        smoothScroll(div_id, by, steps, delay, key);
    }, delay);
}

function scrollTo(div, to, duration) {
    var key = Math.floor((Math.random() * 1000000) + 1);
    var steps = duration / 50;
    var diff = Math.abs(div.scrollTop - to);
    if (diff == 0.0) return;
    var by = 0;
    var delay = duration/steps;
         if (div.scrollTop > to) by = -diff/steps;
    else if (div.scrollTop < to) by =  diff/steps;

    //alert(div.id+" by: "+by+ " steps: "+steps+" delay: "+delay+" scrollTop: "+div.scrollTop+" to: "+to+" duration: "+duration);
    smoothScroll(div.id, by, steps, delay, key);
}

function cg_read_create_filetable(blockchain_file, type, filehash, fsz, type_id) {
    type_id = typeof type_id !== 'undefined' ? type_id : (null);
    var b64Data = btoa(blockchain_file);

    var file_link = document.createElement("A");
    file_link.href = "data:"+type+";charset=utf8;base64,"+b64Data;
    if (filehash !== null) file_link.download = filehash;
    file_link.title = CG_TXT_READ_FILE_TITLE[CG_LANGUAGE];
    file_link.target = "_blank";
    file_link.type = type;

    var link_text = document.createTextNode(CG_TXT_READ_FILE_DOWNLOAD[CG_LANGUAGE]);
    file_link.appendChild(link_text);

    var file_table   = document.createElement("table");
    var file_caption = document.createElement("caption"); file_table.appendChild(file_caption);
    var file_tr1     = document.createElement("tr"); file_table.appendChild(file_tr1);
    var file_tr1_td1 = document.createElement("td"); file_tr1.appendChild(file_tr1_td1);
    var file_tr1_td2 = document.createElement("td"); file_tr1.appendChild(file_tr1_td2);
    var file_tr2     = document.createElement("tr"); file_table.appendChild(file_tr2);
    var file_tr2_td1 = document.createElement("td"); file_tr2.appendChild(file_tr2_td1);
    var file_tr2_td2 = document.createElement("td"); file_tr2.appendChild(file_tr2_td2);
    var file_tr3     = document.createElement("tr"); file_table.appendChild(file_tr3);
    var file_tr3_td1 = document.createElement("td"); file_tr3.appendChild(file_tr3_td1);
    var file_tr3_td2 = document.createElement("td"); file_tr3.appendChild(file_tr3_td2);
    var file_tr4     = document.createElement("tr"); file_table.appendChild(file_tr4);
    var file_tr4_td1 = document.createElement("td"); file_tr4.appendChild(file_tr4_td1);
    var file_tr4_td2 = document.createElement("td"); file_tr4.appendChild(file_tr4_td2);

    file_caption.appendChild(document.createTextNode(CG_TXT_READ_FILE_CAPTION[CG_LANGUAGE]));
    file_tr1_td1.appendChild(document.createTextNode(CG_TXT_READ_FILE_TYPE[CG_LANGUAGE]));
    file_tr2_td1.appendChild(document.createTextNode(CG_TXT_WRITE_NEW_MSG_SIZE[CG_LANGUAGE]));
    file_tr3_td1.appendChild(document.createTextNode(CG_TXT_WRITE_NEW_MSG_HASH[CG_LANGUAGE]));
    file_tr4_td1.appendChild(document.createTextNode(CG_TXT_READ_FILE_LINK[CG_LANGUAGE]));

    var type_select = document.createElement("select");
    file_table.cg_type_select = type_select;
    if (type_id !== null) type_select.id = type_id;
    type_select.classList.add("cg-view-select");
    type_select.file_link = file_link;
    type_select.onchange = function(){
        this.file_link.href = "data:"+this.value+";base64,"+b64Data;
        while (this.file_link.hasChildNodes()) this.file_link.removeChild(this.file_link.lastChild);
        var link_text = document.createTextNode(CG_TXT_READ_FILE_DOWNLOAD[CG_LANGUAGE]);
        this.file_link.title = CG_TXT_READ_FILE_TITLE[CG_LANGUAGE];
        this.file_link.appendChild(link_text);
        if (filehash !== null) this.file_link.download = filehash;
        this.file_link.type = this.value;
    };
    var all_types = {};
    all_types[type] = true;
    for (var key in CG_VIEW_TYPES) {
        if (CG_VIEW_TYPES.hasOwnProperty(key)) {
            all_types[CG_VIEW_TYPES[key]] = true;
        }
    }
    for (var key in all_types) {
        if (all_types.hasOwnProperty(key)) {
            var opt = document.createElement("option");
            opt.classList.add("cg-view-option");
            opt.value = key;
            opt.label = key;
            if (key === type) opt.selected = true;
            var txt = document.createTextNode(key);
            opt.appendChild(txt);
            type_select.appendChild(opt);
        }
    }

    file_tr1_td2.appendChild(type_select);
    file_tr2_td2.appendChild(document.createTextNode((fsz/1024).toFixed(4)+" KiB"));
    file_tr3_td2.appendChild(document.createTextNode(filehash));
    file_tr4_td2.appendChild(file_link);

    return file_table;
}
