(() => {
  // node_modules/posthog-js/dist/module.no-external.js
  function e(e2, t2, i2, r2, s2, n2, o2) {
    try {
      var a2 = e2[n2](o2), l2 = a2.value;
    } catch (e3) {
      return void i2(e3);
    }
    a2.done ? t2(l2) : Promise.resolve(l2).then(r2, s2);
  }
  function t(t2) {
    return function() {
      var i2 = this, r2 = arguments;
      return new Promise(function(s2, n2) {
        var o2 = t2.apply(i2, r2);
        function a2(t3) {
          e(o2, s2, n2, a2, l2, "next", t3);
        }
        function l2(t3) {
          e(o2, s2, n2, a2, l2, "throw", t3);
        }
        a2(void 0);
      });
    };
  }
  function i() {
    return i = Object.assign ? Object.assign.bind() : function(e2) {
      for (var t2 = 1; arguments.length > t2; t2++) {
        var i2 = arguments[t2];
        for (var r2 in i2) ({}).hasOwnProperty.call(i2, r2) && (e2[r2] = i2[r2]);
      }
      return e2;
    }, i.apply(null, arguments);
  }
  function r(e2, t2) {
    if (null == e2) return {};
    var i2 = {};
    for (var r2 in e2) if ({}.hasOwnProperty.call(e2, r2)) {
      if (-1 !== t2.indexOf(r2)) continue;
      i2[r2] = e2[r2];
    }
    return i2;
  }
  var s = "0.2.0";
  var n = { DEBUG: false, LIB_VERSION: s, LIB_NAME: "browser-common", JS_SDK_VERSION: s };
  var o = "1.407.2";
  n.DEBUG = false, n.LIB_VERSION = o, n.LIB_NAME = "web", n.JS_SDK_VERSION = o;
  var a = "$people_distinct_id";
  var l = "$device_id";
  var u = "$device_model";
  var c = "__alias";
  var d = "__timers";
  var _ = "$autocapture_disabled_server_side";
  var h = "$heatmaps_enabled_server_side";
  var p = "$exception_capture_enabled_server_side";
  var g = "$error_tracking_suppression_rules";
  var v = "$error_tracking_capture_extension_exceptions";
  var f = "$web_vitals_enabled_server_side";
  var m = "$dead_clicks_enabled_server_side";
  var y = "$product_tours_enabled_server_side";
  var b = "$web_vitals_allowed_metrics";
  var w = "$session_recording_remote_config";
  var S = "$replay_sample_rate";
  var E = "$replay_override_sampling";
  var x = "$replay_override_linked_flag";
  var k = "$replay_override_url_trigger";
  var P = "$replay_override_event_trigger";
  var I = "$sesid";
  var C = "$session_is_sampled";
  var T = "$enabled_feature_flags";
  var F = "$active_feature_flags";
  var R = "$early_access_features";
  var L = "$feature_flag_details";
  var M = "$feature_flag_payloads";
  var A = "$feature_flag_request_id";
  var O = "$minimal_flag_called_events";
  var D = "$override_feature_flags";
  var N = "$override_feature_flag_payloads";
  var B = "$stored_person_properties";
  var q = "$stored_group_properties";
  var U = "$surveys";
  var H = "$surveys_loaded_at";
  var z = "$surveys_activated";
  var j = "$surveys_activated_session";
  var V = "ph_product_tours";
  var W = "$flag_call_reported";
  var G = "$flag_call_reported_session_id";
  var K = "$feature_flag_errors";
  var Q = "$feature_flag_evaluated_at";
  var Y = "$user_state";
  var J = "$client_session_props";
  var Z = "$capture_rate_limit";
  var X = "$initial_campaign_params";
  var ee = "$initial_referrer_info";
  var te = "$initial_person_info";
  var ie = "$epp";
  var re = "$posthog_cookieless";
  var se = "$cookieless_mode";
  var ne = "$sdk_debug_extensions_init_method";
  var oe = "$sdk_debug_extensions_init_time_ms";
  var ae = "$sdk_debug_recording_script_not_loaded";
  var le = "PostHog loadExternalDependency extension not found.";
  var ue = "on_reject";
  var ce = "always";
  var de = "anonymous";
  var _e = "identified";
  var he = "identified_only";
  var pe = "visibilitychange";
  var ge = "beforeunload";
  var ve = "$pageview";
  var fe = "$pageleave";
  var me = "$identify";
  var ye = "$groupidentify";
  var be = "undefined" != typeof window ? window : void 0;
  var we = "undefined" != typeof globalThis ? globalThis : be;
  var Se = null == we ? void 0 : we.navigator;
  var Ee = null == we ? void 0 : we.document;
  var xe = null == we ? void 0 : we.location;
  var ke = null == we ? void 0 : we.fetch;
  var Pe = null != we && we.XMLHttpRequest && "withCredentials" in new we.XMLHttpRequest() ? we.XMLHttpRequest : void 0;
  var Ie = null == we ? void 0 : we.AbortController;
  var Ce = null == we ? void 0 : we.CompressionStream;
  var Te = null == Se ? void 0 : Se.userAgent;
  function Fe() {
    return !(!be || false === be.navigator.onLine);
  }
  var Re = "undefined" != typeof globalThis ? globalThis : be;
  Re && "undefined" == typeof self && (Re.self = Re), Re && "undefined" == typeof File && (Re.File = function() {
  });
  var Le = null != be ? be : {};
  var Me = (e2) => {
    if ("string" != typeof e2) return e2;
    try {
      return JSON.parse(e2);
    } catch (t2) {
      return e2;
    }
  };
  function Ae(e2) {
    return "string" == typeof e2 || e2;
  }
  function $e(e2) {
    return "string" == typeof e2 ? e2 : void 0;
  }
  var Oe;
  var De = ["$feature_flag", "$feature_flag_response", "$feature_flag_has_experiment", "$feature_flag_id", "$feature_flag_version", "$feature_flag_reason", "$feature_flag_request_id", "$feature_flag_evaluated_at", "$feature_flag_error", "locally_evaluated", "$groups", "$process_person_profile", "$geoip_disable", "$current_url", "$pathname", "$session_id", "$window_id", "$lib", "$lib_version", "$device_id", "$is_server"];
  var Ne = function(e2) {
    return e2.AnonymousId = "anonymous_id", e2.DistinctId = "distinct_id", e2.Props = "props", e2.EnablePersonProcessing = "enable_person_processing", e2.PersonMode = "person_mode", e2.FeatureFlagDetails = "feature_flag_details", e2.FeatureFlags = "feature_flags", e2.FeatureFlagPayloads = "feature_flag_payloads", e2.BootstrapFeatureFlagDetails = "bootstrap_feature_flag_details", e2.BootstrapFeatureFlags = "bootstrap_feature_flags", e2.BootstrapFeatureFlagPayloads = "bootstrap_feature_flag_payloads", e2.OverrideFeatureFlags = "override_feature_flags", e2.Queue = "queue", e2.AiQueue = "ai_queue", e2.LogsQueue = "logs_queue", e2.OptedOut = "opted_out", e2.SessionId = "session_id", e2.SessionStartTimestamp = "session_start_timestamp", e2.SessionLastTimestamp = "session_timestamp", e2.PersonProperties = "person_properties", e2.GroupProperties = "group_properties", e2.InstalledAppBuild = "installed_app_build", e2.InstalledAppVersion = "installed_app_version", e2.SessionReplay = "session_replay", e2.SessionReplayEventTriggerActivatedSession = "session_replay_event_trigger_activated_session", e2.SurveyLastSeenDate = "survey_last_seen_date", e2.SurveysSeen = "surveys_seen", e2.Surveys = "surveys", e2.RemoteConfig = "remote_config", e2.FlagsEndpointWasHit = "flags_endpoint_was_hit", e2.DeviceId = "device_id", e2;
  }({});
  var Be = function(e2) {
    return e2.GZipJS = "gzip-js", e2.Base64 = "base64", e2;
  }({});
  var qe = ["$snapshot", "$pageview", "$pageleave", "$set", "survey dismissed", "survey sent", "survey shown", "$identify", "$groupidentify", "$create_alias", "$$client_ingestion_warning", "$web_experiment_applied", "$feature_enrollment_update", "$feature_flag_called"];
  var Ue = ["token"];
  var He = "NativeGzipValidationError";
  var ze = (e2) => e2.length >= 2 && 31 === e2[0] && 139 === e2[1];
  var je = (e2, t2) => e2 === Be.GZipJS || t2 === Be.GZipJS || "gzip" === t2;
  var Ve = (e2) => !(!e2 || "object" != typeof e2) && "NotReadableError" === ("name" in e2 ? String(e2.name) : "");
  var We = (e2) => {
    var t2 = new Error("Native gzip produced invalid output: " + e2);
    throw t2.name = He, t2;
  };
  var Ge = function() {
    var e2 = t(function* (e3, t2) {
      18 > e3.size && We("too-short");
      var i2 = new Uint8Array(yield e3.slice(0, 10).arrayBuffer());
      ze(i2) && 8 === i2[2] || We("invalid-header");
      var r2 = new DataView(yield e3.slice(e3.size - 8).arrayBuffer());
      r2.getUint32(0, true) !== ((e4) => {
        for (var t3 = (() => {
          if (Oe) return Oe;
          Oe = [];
          for (var e5 = 0; 256 > e5; e5++) {
            for (var t4 = e5, i4 = 0; 8 > i4; i4++) t4 = 1 & t4 ? 3988292384 ^ t4 >>> 1 : t4 >>> 1;
            Oe[e5] = t4 >>> 0;
          }
          return Oe;
        })(), i3 = 4294967295, r3 = 0; e4.length > r3; r3++) i3 = t3[255 & (i3 ^ e4[r3])] ^ i3 >>> 8;
        return (4294967295 ^ i3) >>> 0;
      })(t2) && We("invalid-crc");
      var s2 = t2.length >>> 0;
      r2.getUint32(4, true) !== s2 && We("invalid-size");
    });
    return function(t2, i2) {
      return e2.apply(this, arguments);
    };
  }();
  function Ke() {
    return Ke = t(function* (e2, i2, r2) {
      void 0 === i2 && (i2 = true);
      try {
        var s2 = new TextEncoder().encode(e2), n2 = new globalThis.CompressionStream("gzip"), o2 = n2.writable.getWriter(), a2 = o2.write(s2).then(() => o2.close()).catch(function() {
          var e3 = t(function* (e4) {
            try {
              yield o2.abort(e4);
            } catch (e5) {
            }
            throw e4;
          });
          return function(t2) {
            return e3.apply(this, arguments);
          };
        }()), l2 = new Response(n2.readable).blob(), u2 = (yield Promise.all([l2, a2]))[0];
        return yield Ge(u2, s2), u2;
      } catch (e3) {
        if (null != r2 && r2.rethrow) throw e3;
        return i2 && console.error("Failed to gzip compress data", e3), null;
      }
    }), Ke.apply(this, arguments);
  }
  var Qe = ["amazonbot", "amazonproductbot", "app.hypefactors.com", "applebot", "archive.org_bot", "awariobot", "backlinksextendedbot", "baiduspider", "bingbot", "bingpreview", "chrome-lighthouse", "dataforseobot", "deepscan", "duckduckbot", "facebookexternal", "facebookcatalog", "http://yandex.com/bots", "hubspot", "ia_archiver", "leikibot", "linkedinbot", "meta-externalagent", "mj12bot", "msnbot", "nessus", "petalbot", "pinterest", "prerender", "rogerbot", "screaming frog", "sebot-wa", "sitebulb", "slackbot", "slurp", "trendictionbot", "turnitin", "twitterbot", "vercel-screenshot", "vercelbot", "yahoo! slurp", "yandexbot", "zoombot", "bot.htm", "bot.php", "(bot;", "bot/", "crawler", "ahrefsbot", "ahrefssiteaudit", "semrushbot", "siteauditbot", "splitsignalbot", "gptbot", "oai-searchbot", "chatgpt-user", "perplexitybot", "better uptime bot", "sentryuptimebot", "uptimerobot", "headlesschrome", "cypress", "google-hoteladsverifier", "adsbot-google", "apis-google", "duplexweb-google", "feedfetcher-google", "google favicon", "google web preview", "google-read-aloud", "googlebot", "googleother", "google-cloudvertexbot", "googleweblight", "mediapartners-google", "storebot-google", "google-inspectiontool", "bytespider"];
  var Ye = function(e2, t2) {
    if (void 0 === t2 && (t2 = []), !e2) return false;
    var i2 = e2.toLowerCase();
    return Qe.concat(t2).some((e3) => {
      var t3 = e3.toLowerCase();
      return -1 !== i2.indexOf(t3);
    });
  };
  function Je(e2, t2) {
    return -1 !== e2.indexOf(t2);
  }
  var Ze = function(e2) {
    return e2.trim();
  };
  var Xe = function(e2) {
    return e2.replace(/^\$/, "");
  };
  function et(e2) {
    var t2, i2 = [];
    return null !== (t2 = JSON.stringify(e2, function(e3, t3) {
      if ("bigint" == typeof t3) return t3.toString();
      if ("function" != typeof t3 && "symbol" != typeof t3) {
        if (t3 instanceof Error) return { name: t3.name, message: t3.message, stack: t3.stack };
        if (t3 && "object" == typeof t3) {
          for (; i2.length > 0 && i2[i2.length - 1] !== this; ) i2.pop();
          if (i2.includes(t3)) return "[Circular]";
          i2.push(t3);
        }
        return t3;
      }
    })) && void 0 !== t2 ? t2 : "null";
  }
  var tt = Object.prototype;
  var it = tt.hasOwnProperty;
  var rt = tt.toString;
  var st = Array.isArray || function(e2) {
    return "[object Array]" === rt.call(e2);
  };
  var nt = (e2) => "function" == typeof e2;
  var ot = (e2) => e2 === Object(e2) && !st(e2);
  var at = (e2) => {
    if (ot(e2)) {
      for (var t2 in e2) if (it.call(e2, t2)) return false;
      return true;
    }
    return false;
  };
  var lt = (e2) => void 0 === e2;
  var ut = (e2) => "[object String]" == rt.call(e2);
  var ct = (e2) => ut(e2) && 0 === e2.trim().length;
  var dt = (e2) => null === e2;
  var _t = (e2) => lt(e2) || dt(e2);
  var ht = (e2) => "[object Number]" == rt.call(e2) && e2 == e2;
  var pt = (e2) => ht(e2) && e2 > 0;
  var gt = (e2) => "[object Boolean]" === rt.call(e2);
  var vt = (e2) => e2 instanceof FormData;
  var ft = (e2) => Je(qe, e2);
  var mt = (e2) => Je(Ue, e2);
  function yt(e2) {
    return null === e2 || "object" != typeof e2;
  }
  function bt(e2, t2) {
    return {}.toString.call(e2) === "[object " + t2 + "]";
  }
  function wt(e2) {
    return "undefined" != typeof Event && function(e3, t2) {
      try {
        return e3 instanceof t2;
      } catch (e4) {
        return false;
      }
    }(e2, Event);
  }
  var St = [true, "true", 1, "1", "yes"];
  var Et = (e2) => Je(St, e2);
  var xt = [false, "false", 0, "0", "no"];
  function kt(e2, t2, i2, r2, s2) {
    return t2 > i2 && (r2.warn("min cannot be greater than max."), t2 = i2), ht(e2) ? e2 > i2 ? (r2.warn(" cannot be  greater than max: " + i2 + ". Using max value instead."), i2) : t2 > e2 ? (r2.warn(" cannot be less than min: " + t2 + ". Using min value instead."), t2) : e2 : (r2.warn(" must be a number. using max or fallback. max: " + i2 + ", fallback: " + s2), kt(s2 || i2, t2, i2, r2));
  }
  var Pt = class {
    constructor(e2) {
      this._buckets = {}, this._onBucketRateLimited = e2._onBucketRateLimited, this._bucketSize = kt(e2.bucketSize, 0, 100, e2._logger), this._refillRate = kt(e2.refillRate, 0, this._bucketSize, e2._logger), this._refillInterval = kt(e2.refillInterval, 0, 864e5, e2._logger);
    }
    _applyRefill(e2, t2) {
      var i2 = Math.floor((t2 - e2.lastAccess) / this._refillInterval);
      i2 > 0 && (e2.tokens = Math.min(e2.tokens + i2 * this._refillRate, this._bucketSize), e2.lastAccess = e2.lastAccess + i2 * this._refillInterval);
    }
    consumeRateLimit(e2) {
      var t2, i2 = Date.now(), r2 = String(e2), s2 = this._buckets[r2];
      return s2 ? this._applyRefill(s2, i2) : this._buckets[r2] = s2 = { tokens: this._bucketSize, lastAccess: i2 }, 0 === s2.tokens || (s2.tokens--, 0 === s2.tokens && (null == (t2 = this._onBucketRateLimited) || t2.call(this, e2)), 0 === s2.tokens);
    }
    stop() {
      this._buckets = {};
    }
  };
  var It = "Mobile";
  var Ct = "iOS";
  var Tt = "Android";
  var Ft = "Tablet";
  var Rt = Tt + " " + Ft;
  var Lt = "iPad";
  var Mt = "Apple";
  var At = Mt + " Watch";
  var $t = "Safari";
  var Ot = "BlackBerry";
  var Dt = "Samsung";
  var Nt = Dt + "Browser";
  var Bt = Dt + " Internet";
  var qt = "Chrome";
  var Ut = qt + " OS";
  var Ht = qt + " " + Ct;
  var zt = "Internet Explorer";
  var jt = zt + " " + It;
  var Vt = "Opera";
  var Wt = Vt + " Mini";
  var Gt = "Edge";
  var Kt = "Microsoft " + Gt;
  var Qt = "Firefox";
  var Yt = Qt + " " + Ct;
  var Jt = "Nintendo";
  var Zt = "PlayStation";
  var Xt = "Xbox";
  var ei = Tt + " " + It;
  var ti = It + " " + $t;
  var ii = "Windows";
  var ri = ii + " Phone";
  var si = "Nokia";
  var ni = "Ouya";
  var oi = "Generic";
  var ai = oi + " " + It.toLowerCase();
  var li = oi + " " + Ft.toLowerCase();
  var ui = "Konqueror";
  var ci = "Oculus Browser";
  var di = "Vivaldi";
  var _i = "Yandex";
  var hi = "Whale";
  var pi = "DuckDuckGo";
  var gi = "Pale Moon";
  var vi = "Waterfox";
  var fi = "Brave";
  var mi = "Google Search App";
  var yi = "(\\d+(\\.\\d+)?)";
  var bi = new RegExp("Version/" + yi);
  var wi = new RegExp(Xt, "i");
  var Si = new RegExp(Zt + " \\w+", "i");
  var Ei = new RegExp(Jt + " \\w+", "i");
  var xi = new RegExp(Ot + "|PlayBook|BB10", "i");
  var ki = { "NT3.51": "NT 3.11", "NT4.0": "NT 4.0", "5.0": "2000", 5.1: "XP", 5.2: "XP", "6.0": "Vista", 6.1: "7", 6.2: "8", 6.3: "8.1", 6.4: "10", "10.0": "10" };
  var Pi = function(e2, t2, i2, r2) {
    t2 = t2 || "";
    var s2 = function(e3) {
      return null != e3 && e3.brave ? fi : null;
    }(i2);
    return s2 || (null != r2 && r2.detectGoogleSearchApp && Je(e2, "GSA/") ? mi : Je(e2, " OPR/") && Je(e2, "Mini") ? Wt : Je(e2, " OPR/") ? Vt : xi.test(e2) ? Ot : Je(e2, "IE" + It) || Je(e2, "WPDesktop") ? jt : Je(e2, "OculusBrowser") ? ci : Je(e2, Nt) ? Bt : Je(e2, Gt) || Je(e2, "Edg/") ? Kt : Je(e2, di + "/") ? di : Je(e2, "YaBrowser/") ? _i : Je(e2, hi + "/") ? hi : Je(e2, pi + "/") || Je(e2, "Ddg/") ? pi : Je(e2, "FBIOS") ? "Facebook " + It : Je(e2, "UCWEB") || Je(e2, "UCBrowser") ? "UC Browser" : Je(e2, "CriOS") ? Ht : Je(e2, "CrMo") || Je(e2, qt) ? qt : Je(e2, Tt) && Je(e2, $t) ? ei : Je(e2, "FxiOS") ? Yt : Je(e2.toLowerCase(), ui.toLowerCase()) ? ui : Je(e2, fi + "/") ? fi : ((e3, t3) => t3 && Je(t3, Mt) || function(e4) {
      return Je(e4, $t) && !Je(e4, qt) && !Je(e4, Tt);
    }(e3))(e2, t2) ? Je(e2, It) ? ti : $t : Je(e2, "PaleMoon/") ? gi : Je(e2, vi + "/") ? vi : Je(e2, Qt) ? Qt : Je(e2, "MSIE") || Je(e2, "Trident/") ? zt : Je(e2, "Gecko") ? Qt : "");
  };
  var Ii = { [jt]: [new RegExp("rv:" + yi)], [Kt]: [new RegExp(Gt + "?\\/" + yi)], [qt]: [new RegExp("(" + qt + "|CrMo)\\/" + yi)], [Ht]: [new RegExp("CriOS\\/" + yi)], "UC Browser": [new RegExp("(UCBrowser|UCWEB)\\/" + yi)], [$t]: [bi], [ti]: [bi], [Vt]: [new RegExp("(Opera|OPR)\\/" + yi)], [Qt]: [new RegExp(Qt + "\\/" + yi)], [Yt]: [new RegExp("FxiOS\\/" + yi)], [ui]: [new RegExp("Konqueror[:/]?" + yi, "i")], [Ot]: [new RegExp(Ot + " " + yi), bi], [ei]: [new RegExp("android\\s" + yi, "i")], [Bt]: [new RegExp(Nt + "\\/" + yi)], [ci]: [new RegExp("OculusBrowser\\/" + yi)], [di]: [new RegExp(di + "\\/" + yi)], [_i]: [new RegExp("YaBrowser\\/" + yi)], [hi]: [new RegExp(hi + "\\/" + yi)], [fi]: [new RegExp(fi + "\\/" + yi)], [pi]: [new RegExp("(DuckDuckGo|Ddg)\\/" + yi)], [gi]: [new RegExp("PaleMoon\\/" + yi)], [vi]: [new RegExp(vi + "\\/" + yi)], [mi]: [new RegExp("GSA\\/" + yi)], [zt]: [new RegExp("(rv:|MSIE )" + yi)], Mozilla: [new RegExp("rv:" + yi)] };
  var Ci = function(e2, t2, i2, r2) {
    var s2 = Pi(e2, t2, i2, r2), n2 = Ii[s2];
    if (lt(n2)) return null;
    for (var o2 = 0; n2.length > o2; o2++) {
      var a2 = e2.match(n2[o2]);
      if (a2) return parseFloat(a2[a2.length - 2]);
    }
    return null;
  };
  var Ti = [[new RegExp(Xt + "; " + Xt + " (.*?)[);]", "i"), (e2) => [Xt, e2 && e2[1] || ""]], [new RegExp(Jt, "i"), [Jt, ""]], [new RegExp(Zt, "i"), [Zt, ""]], [xi, [Ot, ""]], [new RegExp(ii, "i"), (e2, t2) => {
    if (/Phone/.test(t2) || /WPDesktop/.test(t2)) return [ri, ""];
    if (new RegExp(It).test(t2) && !/IEMobile\b/.test(t2)) return [ii + " " + It, ""];
    var i2 = /Windows NT ([0-9.]+)/i.exec(t2);
    if (i2 && i2[1]) {
      var r2 = ki[i2[1]] || "";
      return /arm/i.test(t2) && (r2 = "RT"), [ii, r2];
    }
    return [ii, ""];
  }], [/((iPhone|iPad|iPod).*?OS (\d+)_(\d+)_?(\d+)?|iPhone)/, (e2) => e2 && e2[3] ? [Ct, [e2[3], e2[4], e2[5] || "0"].join(".")] : [Ct, ""]], [/(watch.*\/(\d+\.\d+\.\d+)|watch os,(\d+\.\d+),)/i, (e2) => {
    var t2 = "";
    return e2 && e2.length >= 3 && (t2 = lt(e2[2]) ? e2[3] : e2[2]), ["watchOS", t2];
  }], [new RegExp("(" + Tt + " (\\d+)\\.(\\d+)\\.?(\\d+)?|" + Tt + ")", "i"), (e2) => e2 && e2[2] ? [Tt, [e2[2], e2[3], e2[4] || "0"].join(".")] : [Tt, ""]], [/Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i, (e2) => {
    var t2 = ["Mac OS X", ""];
    return e2 && e2[1] && (t2[1] = [e2[1], e2[2], e2[3] || "0"].join(".")), t2;
  }], [/Mac/i, ["Mac OS X", ""]], [/CrOS/, [Ut, ""]], [/Linux|debian/i, ["Linux", ""]]];
  var Fi = function(e2) {
    return Ei.test(e2) ? Jt : Si.test(e2) ? Zt : wi.test(e2) ? Xt : new RegExp(ni, "i").test(e2) ? ni : new RegExp("(" + ri + "|WPDesktop)", "i").test(e2) ? ri : /iPad/.test(e2) ? Lt : /iPod/.test(e2) ? "iPod Touch" : /iPhone/.test(e2) ? "iPhone" : /(watch)(?: ?os[,/]|\d,\d\/)[\d.]+/i.test(e2) ? At : xi.test(e2) ? Ot : /(kobo)\s(ereader|touch)/i.test(e2) ? "Kobo" : new RegExp(si, "i").test(e2) ? si : /(kf[a-z]{2}wi|aeo[c-r]{2})( bui|\))/i.test(e2) || /(kf[a-z]+)( bui|\)).+silk\//i.test(e2) ? "Kindle Fire" : /(Android|ZTE)/i.test(e2) ? new RegExp(It).test(e2) && !/(9138B|TB782B|Nexus [97]|pixel c|HUAWEISHT|BTV|noble nook|smart ultra 6)/i.test(e2) || /pixel[\daxl ]{1,6}/i.test(e2) && !/pixel c/i.test(e2) || /(huaweimed-al00|tah-|APA|SM-G92|i980|zte|U304AA)/i.test(e2) || /lmy47v/i.test(e2) && !/QTAQZ3/i.test(e2) ? Tt : Rt : new RegExp("(pda|" + It + ")", "i").test(e2) ? ai : new RegExp(Ft, "i").test(e2) && !new RegExp(Ft + " pc", "i").test(e2) ? li : "";
  };
  var Ri = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function Li(e2, t2) {
    return "string" == typeof (i2 = e2) && Ri.test(i2) ? e2 : t2();
    var i2;
  }
  function Mi(e2) {
    return e2 ? e2.split("#")[0] : e2;
  }
  function Ai(e2, t2) {
    var i2 = setTimeout(e2, t2);
    return (null == i2 ? void 0 : i2.unref) && (null == i2 || i2.unref()), i2;
  }
  var $i = (e2) => e2 instanceof Error;
  var Oi = { trace: { text: "TRACE", number: 1 }, debug: { text: "DEBUG", number: 5 }, info: { text: "INFO", number: 9 }, warn: { text: "WARN", number: 13 }, error: { text: "ERROR", number: 17 }, fatal: { text: "FATAL", number: 21 } };
  var Di = Oi.info;
  function Ni(e2) {
    if (gt(e2)) return { boolValue: e2 };
    if ("number" == typeof e2) return Number.isFinite(e2) ? Number.isInteger(e2) ? { intValue: e2 } : { doubleValue: e2 } : { stringValue: String(e2) };
    if ("string" == typeof e2) return { stringValue: e2 };
    if (st(e2)) return { arrayValue: { values: e2.map((e3) => Ni(e3)) } };
    try {
      return { stringValue: JSON.stringify(e2) };
    } catch (t2) {
      return { stringValue: String(e2) };
    }
  }
  function Bi(e2) {
    var t2 = [];
    for (var i2 in e2) {
      var r2 = e2[i2];
      dt(r2) || lt(r2) || t2.push({ key: i2, value: Ni(r2) });
    }
    return t2;
  }
  function qi(e2, t2) {
    var r2 = Oi[e2.level || "info"] || Di, s2 = r2.text, n2 = r2.number, o2 = String(Date.now()) + "000000", a2 = {};
    t2.distinctId && (a2.posthogDistinctId = t2.distinctId), t2.sessionId && (a2.sessionId = t2.sessionId), t2.windowId && (a2["window.id"] = t2.windowId), _t(t2.sessionStartTimestamp) || (a2.sessionStartTimestamp = String(t2.sessionStartTimestamp)), _t(t2.lastActivityTimestamp) || (a2.lastActivityTimestamp = String(t2.lastActivityTimestamp)), t2.currentUrl && (a2["url.full"] = t2.currentUrl), t2.screenName && (a2["screen.name"] = t2.screenName), t2.appState && (a2["app.state"] = t2.appState), t2.activeFeatureFlags && t2.activeFeatureFlags.length > 0 && (a2.feature_flags = t2.activeFeatureFlags);
    var l2 = i({}, a2, e2.attributes || {}), u2 = { timeUnixNano: o2, observedTimeUnixNano: o2, severityNumber: n2, severityText: s2, body: { stringValue: e2.body }, attributes: Bi(l2) };
    return e2.trace_id && (u2.traceId = e2.trace_id), e2.span_id && (u2.spanId = e2.span_id), lt(e2.trace_flags) || (u2.flags = e2.trace_flags), u2;
  }
  function Ui(e2, t2, r2) {
    return i({}, e2.resourceAttributes, { "service.name": e2.serviceName || "unknown_service" }, e2.environment && { "deployment.environment": e2.environment }, e2.serviceVersion && { "service.version": e2.serviceVersion }, { "telemetry.sdk.name": t2, "telemetry.sdk.version": r2 });
  }
  function Hi(e2, t2, i2, r2) {
    return { resourceLogs: [{ resource: { attributes: Bi(t2) }, scopeLogs: [{ scope: { name: i2, version: r2 }, logRecords: e2 }] }] };
  }
  var zi = class {
    constructor(e2, t2, i2, r2, s2, n2, o2) {
      var a2;
      void 0 === n2 && (n2 = () => Promise.resolve()), this._instance = e2, this._config = t2, this._logger = i2, this._getContext = r2, this._onReady = s2, this._waitForStoragePersist = n2, this._scopeName = o2, this._flushPromise = null, this._evictedSinceAdvance = 0, this._consecutiveFlushFailures = 0, this._intervalWindowStart = 0, this._intervalLogCount = 0, this._droppedWarned = false, this._maxBufferSize = t2.maxBufferSize, this._maxQueueSize = Math.max(null !== (a2 = t2.maxQueueSize) && void 0 !== a2 ? a2 : t2.maxBufferSize, t2.maxBufferSize), this._flushIntervalMs = t2.flushIntervalMs, this._maxBatchRecordsPerPost = t2.maxBatchRecordsPerPost, this._rateCapWindowMs = t2.rateCapWindowMs, this._maxLogsPerInterval = t2.maxLogsPerInterval;
    }
    reset() {
      this._clearFlushTimer(), this._flushPromise = null, this._intervalWindowStart = 0, this._intervalLogCount = 0, this._droppedWarned = false, this._evictedSinceAdvance = 0, this._consecutiveFlushFailures = 0, this._maxBatchRecordsPerPost = this._config.maxBatchRecordsPerPost;
    }
    onReconnect() {
      this._consecutiveFlushFailures = 0, this._flushInBackground();
    }
    captureLog(e2) {
      if (!this._instance.isDisabled && !this._instance.optedOut && null != e2 && e2.body) {
        var t2 = this._runBeforeSend(e2);
        if (null !== t2) if (t2.body) {
          if (this._checkRateLimit()) {
            var i2 = { record: qi(t2, this._getContext()) };
            this._onReady(() => this._enqueue(i2));
          }
        } else this._logger.info("Log was rejected in beforeSend function");
      }
    }
    _runBeforeSend(e2) {
      var t2 = this._config.beforeSend;
      if (!t2) return e2;
      var i2 = st(t2) ? t2 : [t2], r2 = e2;
      for (var s2 of i2) try {
        var n2 = s2(r2);
        if (!n2) return this._logger.info("Log was rejected in beforeSend function"), null;
        r2 = n2;
      } catch (e3) {
        return this._logger.error("Error in beforeSend function for log:", e3), null;
      }
      return r2;
    }
    _checkRateLimit() {
      if (void 0 === this._maxLogsPerInterval) return true;
      var e2 = Date.now(), t2 = e2 - this._intervalWindowStart;
      return this._rateCapWindowMs > t2 && t2 >= 0 || (this._intervalWindowStart = e2, this._intervalLogCount = 0, this._droppedWarned = false), this._maxLogsPerInterval > this._intervalLogCount ? (this._intervalLogCount++, true) : (this._droppedWarned || (this._logger.warn("captureLog dropping logs: exceeded " + this._maxLogsPerInterval + " logs per " + this._rateCapWindowMs + "ms"), this._droppedWarned = true), false);
    }
    flush() {
      var e2 = this;
      return t(function* () {
        if (!e2._instance.isDisabled) return e2._flushPromise || (e2._flushPromise = e2._flushInner().finally(() => {
          e2._flushPromise = null;
        })), e2._flushPromise;
      })();
    }
    _flushInner() {
      var e2 = this;
      return t(function* () {
        var t2;
        e2._clearFlushTimer();
        var i2 = null !== (t2 = e2._instance.getPersistedProperty(Ne.LogsQueue)) && void 0 !== t2 ? t2 : [];
        if (0 !== i2.length) for (var r2 = i2.length, s2 = 0; i2.length > 0 && r2 > s2; ) {
          var n2, o2;
          e2._evictedSinceAdvance = 0;
          var a2 = Math.min(i2.length, e2._maxBatchRecordsPerPost), l2 = i2.slice(0, a2), u2 = Hi(l2.map((e3) => e3.record), e2._buildResourceAttributes(), null !== (n2 = e2._scopeName) && void 0 !== n2 ? n2 : e2._instance.getLibraryId(), e2._instance.getLibraryVersion()), c2 = yield e2._instance._sendLogsBatch(u2);
          if ("too-large" === c2.kind && l2.length > 1) e2._maxBatchRecordsPerPost = Math.max(1, Math.floor(l2.length / 2)), e2._logger.warn("Received 413 when sending logs batch of size " + l2.length + ", reducing batch size to " + e2._maxBatchRecordsPerPost);
          else {
            if ("retry-later" === c2.kind) throw c2.error;
            if ("too-large" === c2.kind ? e2._logger.warn("Dropping a single log record after 413 with batch size 1 \u2014 the record is larger than the server cap and cannot be split further.") : "ok" === c2.kind && e2._config.maxBatchRecordsPerPost > e2._maxBatchRecordsPerPost && (e2._maxBatchRecordsPerPost = Math.min(e2._config.maxBatchRecordsPerPost, e2._maxBatchRecordsPerPost + 1)), yield e2._persistQueueAdvance(l2.length), i2 = null !== (o2 = e2._instance.getPersistedProperty(Ne.LogsQueue)) && void 0 !== o2 ? o2 : [], s2 += l2.length, "fatal" === c2.kind) throw c2.error;
          }
        }
      })();
    }
    _persistQueueAdvance(e2) {
      var i2 = this;
      return t(function* () {
        var t2, r2 = Math.max(0, e2 - i2._evictedSinceAdvance), s2 = null !== (t2 = i2._instance.getPersistedProperty(Ne.LogsQueue)) && void 0 !== t2 ? t2 : [];
        i2._instance.setPersistedProperty(Ne.LogsQueue, s2.slice(r2)), yield i2._waitForStoragePersist();
      })();
    }
    _buildResourceAttributes() {
      return Ui(this._config, this._instance.getLibraryId(), this._instance.getLibraryVersion());
    }
    _enqueue(e2) {
      var t2;
      if (!this._instance.optedOut) {
        var i2 = null !== (t2 = this._instance.getPersistedProperty(Ne.LogsQueue)) && void 0 !== t2 ? t2 : [];
        this._maxQueueSize > i2.length || (i2.shift(), this._evictedSinceAdvance++, this._logger.info("Logs queue is full, dropping oldest record.")), i2.push(e2), this._instance.setPersistedProperty(Ne.LogsQueue, i2), this._maxBufferSize > i2.length ? this._armFlushTimer() : this._flushInBackground();
      }
    }
    _armFlushTimer(e2) {
      void 0 === e2 && (e2 = this._flushIntervalMs), this._flushTimer || (this._flushTimer = Ai(() => {
        this._flushTimer = void 0, this._flushInBackground();
      }, e2));
    }
    _nextFlushDelay() {
      var e2 = Math.min(Math.max(0, this._consecutiveFlushFailures - 1), 6);
      return this._flushIntervalMs * Math.pow(2, e2);
    }
    _hasQueuedRecords() {
      var e2 = this._instance.getPersistedProperty(Ne.LogsQueue);
      return !!e2 && e2.length > 0;
    }
    shutdown(e2) {
      var i2 = this;
      return t(function* () {
        i2._clearFlushTimer();
        var t2 = i2.flush().catch(() => {
        });
        void 0 !== e2 ? yield Promise.race([t2, new Promise((t3) => Ai(t3, e2))]) : yield t2;
      })();
    }
    flushWithTimeout(e2) {
      var i2 = this;
      return t(function* () {
        var t2 = false, r2 = i2.flush(), s2 = new Promise((i3) => Ai(() => {
          t2 = true, i3();
        }, e2));
        try {
          yield Promise.race([r2, s2]);
        } finally {
          t2 && r2.catch(() => {
          });
        }
      })();
    }
    _flushInBackground() {
      this.flush().then(() => {
        this._consecutiveFlushFailures = 0;
      }, (e2) => {
        this._consecutiveFlushFailures++, this._logger.error("PostHog logs flush failed:", e2);
      }).finally(() => {
        !this._instance.isDisabled && this._hasQueuedRecords() && this._armFlushTimer(this._nextFlushDelay());
      });
    }
    _clearFlushTimer() {
      this._flushTimer && (clearTimeout(this._flushTimer), this._flushTimer = void 0);
    }
  };
  var ji = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1e3, 2500, 5e3, 7500, 1e4];
  function Vi(e2) {
    return String(e2) + "000000";
  }
  function Wi(e2, t2, i2, r2) {
    var s2 = "";
    return r2 && (s2 = Object.keys(r2).sort().map((e3) => JSON.stringify(e3) + ":" + JSON.stringify(r2[e3])).join(",")), e2 + "\0" + t2 + "\0" + (null != i2 ? i2 : "") + "\0" + s2;
  }
  var Gi = class {
    constructor(e2, t2, i2) {
      this._instance = e2, this._config = t2, this._logger = i2, this._series = /* @__PURE__ */ new Map(), this._flushPromise = null, this._seriesCapWarned = false, this._typeByName = /* @__PURE__ */ new Map(), this._typeCollisionWarned = /* @__PURE__ */ new Set(), this._generation = 0;
    }
    count(e2, t2, i2) {
      void 0 === t2 && (t2 = 1), this._capture({ name: e2, type: "count", value: t2, unit: null == i2 ? void 0 : i2.unit, attributes: null == i2 ? void 0 : i2.attributes });
    }
    gauge(e2, t2, i2) {
      this._capture({ name: e2, type: "gauge", value: t2, unit: null == i2 ? void 0 : i2.unit, attributes: null == i2 ? void 0 : i2.attributes });
    }
    histogram(e2, t2, i2) {
      this._capture({ name: e2, type: "histogram", value: t2, unit: null == i2 ? void 0 : i2.unit, attributes: null == i2 ? void 0 : i2.attributes });
    }
    flush() {
      var e2 = this, i2 = this._flushPromise, r2 = function() {
        var r3 = t(function* () {
          i2 && (yield i2.catch(() => {
          })), yield e2._doFlush();
        });
        return function() {
          return r3.apply(this, arguments);
        };
      }(), s2 = r2().finally(() => {
        this._flushPromise === s2 && (this._flushPromise = null);
      });
      return this._flushPromise = s2, s2;
    }
    drainWindow() {
      if (0 === this._series.size) return null;
      var e2 = this._series;
      return this._series = /* @__PURE__ */ new Map(), this._seriesCapWarned = false, this._typeByName = /* @__PURE__ */ new Map(), this._typeCollisionWarned = /* @__PURE__ */ new Set(), this._buildPayload(e2);
    }
    reset() {
      this._generation++, this._clearFlushTimer(), this._series = /* @__PURE__ */ new Map(), this._flushPromise = null, this._seriesCapWarned = false, this._typeByName = /* @__PURE__ */ new Map(), this._typeCollisionWarned = /* @__PURE__ */ new Set();
    }
    _capture(e2) {
      if (!this._instance.isDisabled && !this._instance.optedOut) {
        var t2 = this._runBeforeSend(e2);
        if (null !== t2) if (t2.name && "string" == typeof t2.name) if ("number" == typeof t2.value && Number.isFinite(t2.value)) if ("count" === t2.type && 0 > t2.value) this._logger.warn("Dropping count '" + t2.name + "': counters are monotonic, value must be >= 0");
        else {
          var r2, s2;
          try {
            r2 = t2.attributes ? i({}, t2.attributes) : void 0, s2 = Wi(t2.type, t2.name, t2.unit, r2);
          } catch (e3) {
            return void this._logger.warn("Dropping metric '" + t2.name + "': attributes could not be serialized", e3);
          }
          var n2 = this._series.get(s2);
          if (!n2) {
            if (!this._admitNewSeries()) return;
            n2 = { name: t2.name, type: t2.type, unit: t2.unit, attributes: r2, windowStartMs: Date.now() }, this._series.set(s2, n2);
          }
          var o2 = this._typeByName.get(t2.name);
          void 0 === o2 ? this._typeByName.set(t2.name, t2.type) : o2 === t2.type || this._typeCollisionWarned.has(t2.name) || (this._typeCollisionWarned.add(t2.name), this._logger.warn("Metric name '" + t2.name + "' is already used as a " + o2 + "; recording it as a " + t2.type + " too will blend both series in charts. Use a distinct name.")), this._fold(n2, t2.value), this._armFlushTimer();
        }
        else this._logger.warn("Dropping metric '" + t2.name + "': value must be a finite number");
        else this._logger.warn("Dropping metric with empty name");
      }
    }
    _admitNewSeries() {
      return this._config.maxSeriesPerFlush > this._series.size || (this._seriesCapWarned || (this._seriesCapWarned = true, this._logger.warn("Metric series cap reached (" + this._config.maxSeriesPerFlush + " per flush window); dropping new series until the next flush. Reduce attribute cardinality.")), false);
    }
    _fold(e2, t2) {
      var i2;
      switch (e2.type) {
        case "count":
          e2.total = (null !== (i2 = e2.total) && void 0 !== i2 ? i2 : 0) + t2;
          break;
        case "gauge":
          e2.last = t2;
          break;
        case "histogram":
          e2.hist || (e2.hist = { count: 0, sum: 0, min: t2, max: t2, bucketCounts: new Array(ji.length + 1).fill(0) });
          var r2 = e2.hist;
          r2.count += 1, r2.sum += t2, r2.min = Math.min(r2.min, t2), r2.max = Math.max(r2.max, t2), r2.bucketCounts[function(e3, t3) {
            for (var i3 = 0; t3.length > i3; i3++) if (t3[i3] >= e3) return i3;
            return t3.length;
          }(t2, ji)] += 1;
      }
    }
    _runBeforeSend(e2) {
      var t2 = this._config.beforeSend;
      if (!t2) return e2;
      var i2 = st(t2) ? t2 : [t2], r2 = e2;
      for (var s2 of i2) try {
        var n2 = s2(r2);
        if (!n2) return this._logger.info("Metric was rejected in beforeSend function"), null;
        r2 = n2;
      } catch (e3) {
        return this._logger.error("Error in beforeSend function for metric:", e3), null;
      }
      return r2;
    }
    _armFlushTimer() {
      this._flushTimer || (this._flushTimer = Ai(() => {
        this._flushTimer = void 0, this.flush().catch((e2) => {
          this._logger.error("Metrics flush failed:", e2);
        });
      }, this._config.flushIntervalMs));
    }
    _clearFlushTimer() {
      this._flushTimer && (clearTimeout(this._flushTimer), this._flushTimer = void 0);
    }
    _doFlush() {
      var e2 = this;
      return t(function* () {
        if (0 !== e2._series.size) {
          var t2 = e2._series;
          e2._series = /* @__PURE__ */ new Map(), e2._seriesCapWarned = false, e2._typeByName = /* @__PURE__ */ new Map(), e2._typeCollisionWarned = /* @__PURE__ */ new Set();
          var i2 = e2._generation, r2 = yield e2._instance._sendMetricsBatch(e2._buildPayload(t2));
          if (i2 === e2._generation) switch (r2.kind) {
            case "ok":
              return;
            case "retry-later":
              return e2._mergeWindowBack(t2), void e2._armFlushTimer();
            case "too-large":
              return void e2._logger.warn("Metrics batch exceeded the server size limit and was dropped");
            case "fatal":
              return void e2._logger.error("Failed to send metrics batch:", r2.error);
          }
        }
      })();
    }
    _buildPayload(e2) {
      return t2 = this._buildMetrics(e2), r2 = function(e3, t3, r3) {
        return i({}, e3.resourceAttributes, { "service.name": e3.serviceName || "unknown_service" }, e3.environment && { "deployment.environment": e3.environment }, e3.serviceVersion && { "service.version": e3.serviceVersion }, { "telemetry.sdk.name": t3, "telemetry.sdk.version": r3 });
      }(this._config, this._instance.getLibraryId(), this._instance.getLibraryVersion()), s2 = this._instance.getLibraryId(), n2 = this._instance.getLibraryVersion(), { resourceMetrics: [{ resource: { attributes: Bi(r2) }, scopeMetrics: [{ scope: { name: s2, version: n2 }, metrics: t2 }] }] };
      var t2, r2, s2, n2;
    }
    _buildMetrics(e2) {
      var t2 = Vi(Date.now()), r2 = /* @__PURE__ */ new Map();
      for (var s2 of e2.values()) {
        var n2, o2 = Wi(s2.type, s2.name, s2.unit, void 0), a2 = r2.get(o2);
        a2 || (a2 = i({ name: s2.name }, s2.unit && { unit: s2.unit }), "count" === s2.type ? a2.sum = { aggregationTemporality: 1, isMonotonic: true, dataPoints: [] } : "gauge" === s2.type ? a2.gauge = { dataPoints: [] } : a2.histogram = { aggregationTemporality: 1, dataPoints: [] }, r2.set(o2, a2));
        var l2 = Bi(null !== (n2 = s2.attributes) && void 0 !== n2 ? n2 : {}), u2 = Vi(s2.windowStartMs);
        if ("count" === s2.type) {
          var c2, d2 = { attributes: l2, startTimeUnixNano: u2, timeUnixNano: t2, asDouble: null !== (c2 = s2.total) && void 0 !== c2 ? c2 : 0 };
          a2.sum.dataPoints.push(d2);
        } else if ("gauge" === s2.type) {
          var _2, h2 = { attributes: l2, timeUnixNano: t2, asDouble: null !== (_2 = s2.last) && void 0 !== _2 ? _2 : 0 };
          a2.gauge.dataPoints.push(h2);
        } else s2.hist && a2.histogram.dataPoints.push({ attributes: l2, startTimeUnixNano: u2, timeUnixNano: t2, count: s2.hist.count, sum: s2.hist.sum, min: s2.hist.min, max: s2.hist.max, bucketCounts: s2.hist.bucketCounts, explicitBounds: ji });
      }
      return Array.from(r2.values());
    }
    _mergeWindowBack(e2) {
      var t2, i2;
      for (var r2 of e2) {
        var s2 = r2[0], n2 = r2[1], o2 = this._series.get(s2);
        if (o2) switch (o2.windowStartMs = Math.min(o2.windowStartMs, n2.windowStartMs), o2.type) {
          case "count":
            o2.total = (null !== (t2 = o2.total) && void 0 !== t2 ? t2 : 0) + (null !== (i2 = n2.total) && void 0 !== i2 ? i2 : 0);
            break;
          case "gauge":
            break;
          case "histogram":
            if (n2.hist) if (o2.hist) {
              o2.hist.count += n2.hist.count, o2.hist.sum += n2.hist.sum, o2.hist.min = Math.min(o2.hist.min, n2.hist.min), o2.hist.max = Math.max(o2.hist.max, n2.hist.max);
              for (var a2 = 0; o2.hist.bucketCounts.length > a2; a2++) o2.hist.bucketCounts[a2] += n2.hist.bucketCounts[a2];
            } else o2.hist = n2.hist;
        }
        else this._admitNewSeries() && this._series.set(s2, n2);
      }
    }
  };
  var Ki;
  var Qi;
  var Yi;
  function Ji(e2) {
    var t2 = globalThis._posthogChunkIds;
    if (t2) {
      var i2 = Object.keys(t2);
      return Yi && i2.length === Qi || (Qi = i2.length, Yi = i2.reduce((i3, r2) => {
        Ki || (Ki = {});
        var s2 = Ki[r2];
        if (s2) i3[s2[0]] = s2[1];
        else for (var n2 = e2(r2), o2 = n2.length - 1; o2 >= 0; o2--) {
          var a2 = n2[o2], l2 = null == a2 ? void 0 : a2.filename, u2 = t2[r2];
          if (l2 && u2) {
            i3[l2] = u2, Ki[r2] = [l2, u2];
            break;
          }
        }
        return i3;
      }, {})), Yi;
    }
  }
  var Zi = class {
    constructor(e2, t2, i2) {
      void 0 === i2 && (i2 = []), this.coercers = e2, this.stackParser = t2, this.modifiers = i2;
    }
    buildFromUnknown(e2, t2) {
      void 0 === t2 && (t2 = {});
      var i2 = t2 && t2.mechanism || { handled: true, type: "generic" }, r2 = this.buildCoercingContext(i2, t2, 0).apply(e2), s2 = this.buildParsingContext(t2), n2 = this.parseStacktrace(r2, s2);
      return { $exception_list: this.convertToExceptionList(n2, i2), $exception_level: "error" };
    }
    modifyFrames(e2) {
      var i2 = this;
      return t(function* () {
        for (var t2 of e2) t2.stacktrace && t2.stacktrace.frames && st(t2.stacktrace.frames) && (t2.stacktrace.frames = yield i2.applyModifiers(t2.stacktrace.frames));
        return e2;
      })();
    }
    coerceFallback(e2) {
      var t2;
      return { type: "Error", value: "Unknown error", stack: null == (t2 = e2.syntheticException) ? void 0 : t2.stack, synthetic: true };
    }
    parseStacktrace(e2, t2) {
      var r2, s2;
      return null != e2.cause && (r2 = this.parseStacktrace(e2.cause, t2)), "" != e2.stack && null != e2.stack && (s2 = this.applyChunkIds(this.stackParser(e2.stack, e2.synthetic ? t2.skipFirstLines : 0), t2.chunkIdMap)), i({}, e2, { cause: r2, stack: s2 });
    }
    applyChunkIds(e2, t2) {
      return e2.map((e3) => (e3.filename && t2 && (e3.chunk_id = t2[e3.filename]), e3));
    }
    applyCoercers(e2, t2) {
      for (var i2 of this.coercers) if (i2.match(e2)) return i2.coerce(e2, t2);
      return this.coerceFallback(t2);
    }
    applyModifiers(e2) {
      var i2 = this;
      return t(function* () {
        var t2 = e2;
        for (var r2 of i2.modifiers) t2 = yield r2(t2);
        return t2;
      })();
    }
    convertToExceptionList(e2, t2) {
      var r2, s2, n2, o2 = { type: e2.type, value: e2.value, mechanism: { type: null !== (r2 = t2.type) && void 0 !== r2 ? r2 : "generic", handled: null === (s2 = t2.handled) || void 0 === s2 || s2, synthetic: null !== (n2 = e2.synthetic) && void 0 !== n2 && n2 } };
      e2.stack && (o2.stacktrace = { type: "raw", frames: e2.stack });
      var a2 = [o2];
      return null != e2.cause && a2.push(...this.convertToExceptionList(e2.cause, i({}, t2, { handled: true }))), a2;
    }
    buildParsingContext(e2) {
      var t2;
      return { chunkIdMap: Ji(this.stackParser), skipFirstLines: null !== (t2 = e2.skipFirstLines) && void 0 !== t2 ? t2 : 1 };
    }
    buildCoercingContext(e2, t2, r2) {
      void 0 === r2 && (r2 = 0);
      var s2 = (i2, r3) => {
        if (4 >= r3) {
          var s3 = this.buildCoercingContext(e2, t2, r3);
          return this.applyCoercers(i2, s3);
        }
      };
      return i({}, t2, { syntheticException: 0 == r2 ? t2.syntheticException : void 0, mechanism: e2, apply: (e3) => s2(e3, r2), next: (e3) => s2(e3, r2 + 1) });
    }
  };
  var Xi = "?";
  function er(e2, t2, i2, r2, s2) {
    var n2 = { platform: e2, filename: t2, function: "<anonymous>" === i2 ? Xi : i2, in_app: true };
    return lt(r2) || (n2.lineno = r2), lt(s2) || (n2.colno = s2), n2;
  }
  var tr = (e2, t2) => {
    var i2 = -1 !== e2.indexOf("safari-extension"), r2 = -1 !== e2.indexOf("safari-web-extension");
    return i2 || r2 ? [-1 !== e2.indexOf("@") ? e2.split("@")[0] : Xi, i2 ? "safari-extension:" + t2 : "safari-web-extension:" + t2] : [e2, t2];
  };
  var ir = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i;
  var rr = /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
  var sr = /\((\S*)(?::(\d+))(?::(\d+))\)/;
  var nr = (e2, t2) => {
    var i2 = ir.exec(e2);
    if (i2) return er(t2, i2[1], Xi, +i2[2], +i2[3]);
    var r2 = rr.exec(e2);
    if (r2) {
      if (r2[2] && 0 === r2[2].indexOf("eval")) {
        var s2 = sr.exec(r2[2]);
        s2 && (r2[2] = s2[1], r2[3] = s2[2], r2[4] = s2[3]);
      }
      var n2 = tr(r2[1] || Xi, r2[2]);
      return er(t2, n2[1], n2[0], r2[3] ? +r2[3] : void 0, r2[4] ? +r2[4] : void 0);
    }
  };
  var or = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i;
  var ar = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;
  var lr = (e2, t2) => {
    var i2 = or.exec(e2);
    if (i2) {
      if (i2[3] && i2[3].indexOf(" > eval") > -1) {
        var r2 = ar.exec(i2[3]);
        r2 && (i2[1] = i2[1] || "eval", i2[3] = r2[1], i2[4] = r2[2], i2[5] = "");
      }
      var s2 = i2[3], n2 = i2[1] || Xi, o2 = tr(n2, s2);
      return er(t2, s2 = o2[1], n2 = o2[0], i2[4] ? +i2[4] : void 0, i2[5] ? +i2[5] : void 0);
    }
  };
  var ur = /\(error: (.*)\)/;
  var cr = class {
    match(e2) {
      return this.isDOMException(e2) || this.isDOMError(e2);
    }
    coerce(e2, t2) {
      var i2 = ut(e2.stack);
      return { type: this.getType(e2), value: this.getValue(e2), stack: i2 ? e2.stack : void 0, cause: e2.cause ? t2.next(e2.cause) : void 0, synthetic: false };
    }
    getType(e2) {
      return this.isDOMError(e2) ? "DOMError" : "DOMException";
    }
    getValue(e2) {
      var t2 = e2.name || (this.isDOMError(e2) ? "DOMError" : "DOMException");
      return e2.message ? t2 + ": " + e2.message : t2;
    }
    isDOMException(e2) {
      return bt(e2, "DOMException");
    }
    isDOMError(e2) {
      return bt(e2, "DOMError");
    }
  };
  var dr = class {
    match(e2) {
      return ((e3) => e3 instanceof Error)(e2);
    }
    coerce(e2, t2) {
      return { type: this.getType(e2), value: this.getMessage(e2, t2), stack: this.getStack(e2), cause: e2.cause ? t2.next(e2.cause) : void 0, synthetic: false };
    }
    getType(e2) {
      return e2.name || e2.constructor.name;
    }
    getMessage(e2, t2) {
      var i2 = e2.message;
      return String(i2.error && "string" == typeof i2.error.message ? i2.error.message : i2);
    }
    getStack(e2) {
      return e2.stacktrace || e2.stack || void 0;
    }
  };
  var _r = class {
    constructor() {
    }
    match(e2) {
      return bt(e2, "ErrorEvent") && null != e2.error;
    }
    coerce(e2, t2) {
      var i2;
      return t2.apply(e2.error) || { type: "ErrorEvent", value: e2.message, stack: null == (i2 = t2.syntheticException) ? void 0 : i2.stack, synthetic: true };
    }
  };
  var hr = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i;
  var pr = class {
    match(e2) {
      return "string" == typeof e2;
    }
    coerce(e2, t2) {
      var i2, r2 = this.getInfos(e2), s2 = r2[0], n2 = r2[1];
      return { type: null != s2 ? s2 : "Error", value: null != n2 ? n2 : e2, stack: null == (i2 = t2.syntheticException) ? void 0 : i2.stack, synthetic: true };
    }
    getInfos(e2) {
      var t2 = "Error", i2 = e2, r2 = e2.match(hr);
      return r2 && (t2 = r2[1], i2 = r2[2]), [t2, i2];
    }
  };
  var gr = ["fatal", "error", "warning", "log", "info", "debug"];
  function vr(e2, t2) {
    void 0 === t2 && (t2 = 40);
    var i2 = Object.keys(e2);
    if (i2.sort(), !i2.length) return "[object has no keys]";
    for (var r2 = i2.length; r2 > 0; r2--) {
      var s2 = i2.slice(0, r2).join(", ");
      if (t2 >= s2.length) return r2 === i2.length ? s2 : s2.length > t2 ? s2.slice(0, t2) + "..." : s2;
    }
    return "";
  }
  var fr = class {
    match(e2) {
      return "object" == typeof e2 && null !== e2;
    }
    coerce(e2, t2) {
      var i2, r2 = this.getErrorPropertyFromObject(e2);
      return r2 ? t2.apply(r2) : { type: this.getType(e2), value: this.getValue(e2), stack: null == (i2 = t2.syntheticException) ? void 0 : i2.stack, level: this.isSeverityLevel(e2.level) ? e2.level : "error", synthetic: true };
    }
    getType(e2) {
      return wt(e2) ? e2.constructor.name : "Error";
    }
    getValue(e2) {
      if ("name" in e2 && "string" == typeof e2.name) {
        var t2 = "'" + e2.name + "' captured as exception";
        return "message" in e2 && "string" == typeof e2.message && (t2 += " with message: '" + e2.message + "'"), t2;
      }
      if ("message" in e2 && "string" == typeof e2.message) return e2.message;
      var i2 = this.getObjectClassName(e2);
      return (i2 && "Object" !== i2 ? "'" + i2 + "'" : "Object") + " captured as exception with keys: " + vr(e2);
    }
    isSeverityLevel(e2) {
      return ut(e2) && !ct(e2) && gr.indexOf(e2) >= 0;
    }
    getErrorPropertyFromObject(e2) {
      for (var t2 in e2) if ({}.hasOwnProperty.call(e2, t2)) {
        var i2 = e2[t2];
        if ($i(i2)) return i2;
      }
    }
    getObjectClassName(e2) {
      try {
        var t2 = Object.getPrototypeOf(e2);
        return t2 ? t2.constructor.name : void 0;
      } catch (e3) {
        return;
      }
    }
  };
  var mr = class {
    match(e2) {
      return wt(e2);
    }
    coerce(e2, t2) {
      var i2, r2 = e2.constructor.name;
      return { type: r2, value: r2 + " captured as exception with keys: " + vr(e2), stack: null == (i2 = t2.syntheticException) ? void 0 : i2.stack, synthetic: true };
    }
  };
  var yr = class {
    match(e2) {
      return yt(e2);
    }
    coerce(e2, t2) {
      var i2;
      return { type: "Error", value: "Primitive value captured as exception: " + String(e2), stack: null == (i2 = t2.syntheticException) ? void 0 : i2.stack, synthetic: true };
    }
  };
  var br = class {
    match(e2) {
      return bt(e2, "PromiseRejectionEvent") || this.isCustomEventWrappingRejection(e2);
    }
    isCustomEventWrappingRejection(e2) {
      if (!wt(e2)) return false;
      try {
        var t2 = e2.detail;
        return null != t2 && "object" == typeof t2 && "reason" in t2;
      } catch (e3) {
        return false;
      }
    }
    coerce(e2, t2) {
      var i2, r2 = this.getUnhandledRejectionReason(e2);
      return yt(r2) ? { type: "UnhandledRejection", value: "Non-Error promise rejection captured with value: " + String(r2), stack: null == (i2 = t2.syntheticException) ? void 0 : i2.stack, synthetic: true } : t2.apply(r2);
    }
    getUnhandledRejectionReason(e2) {
      try {
        if ("reason" in e2) return e2.reason;
        if ("detail" in e2 && null != e2.detail && "object" == typeof e2.detail && "reason" in e2.detail) return e2.detail.reason;
      } catch (e3) {
      }
      return e2;
    }
  };
  var wr = "$message";
  var Sr = "$timestamp";
  var Er = /* @__PURE__ */ new Set([wr, Sr]);
  var xr = { enabled: true, max_bytes: 32768 };
  function kr(e2) {
    var t2;
    return e2 ? { enabled: null !== (t2 = e2.enabled) && void 0 !== t2 ? t2 : xr.enabled, max_bytes: Ir(e2.max_bytes, xr.max_bytes) } : i({}, xr);
  }
  var Pr = class {
    constructor(e2) {
      this._entries = [], this._totalBytes = 0, this._config = kr(e2);
    }
    setConfig(e2) {
      this._config = kr(e2), this._trimToMaxBytes();
    }
    add(e2) {
      var t2 = function(e3) {
        var t3;
        try {
          t3 = et(e3);
        } catch (e4) {
          return;
        }
        try {
          var i3 = JSON.parse(t3);
          if (!ot(i3)) return;
          var r2 = i3, s2 = r2[wr], n2 = r2[Sr];
          if (!ut(s2) || 0 === s2.trim().length) return;
          if (!ut(n2) && !ht(n2)) return;
          return { step: r2, json: t3 };
        } catch (e4) {
          return;
        }
      }(e2);
      if (t2) {
        var i2 = function(e3) {
          if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(e3).length;
          for (var t3 = encodeURIComponent(e3), i3 = 0, r2 = 0; t3.length > r2; r2++) "%" === t3[r2] ? (i3 += 1, r2 += 2) : i3 += 1;
          return i3;
        }(t2.json);
        i2 > this._config.max_bytes || (this._entries.push({ step: t2.step, bytes: i2 }), this._totalBytes += i2, this._trimToMaxBytes());
      }
    }
    getAttachable() {
      return this._entries.map((e2) => e2.step);
    }
    clear() {
      this._entries = [], this._totalBytes = 0;
    }
    size() {
      return this._entries.length;
    }
    _trimToMaxBytes() {
      for (; this._totalBytes > this._config.max_bytes && this._entries.length > 0; ) {
        var e2 = this._entries.shift();
        e2 && (this._totalBytes -= e2.bytes);
      }
    }
  };
  function Ir(e2, t2) {
    if (!ht(e2) || e2 === 1 / 0 || e2 === -1 / 0) return t2;
    var i2 = Math.floor(e2);
    return 0 > i2 ? t2 : i2;
  }
  var Cr = function(e2, t2) {
    var i2 = (void 0 === t2 ? {} : t2).debugEnabled, r2 = { _log(t3) {
      if (be && (n.DEBUG || be.POSTHOG_DEBUG || i2) && !lt(be.console) && be.console) {
        for (var r3 = ("__rrweb_original__" in be.console[t3]) ? be.console[t3].__rrweb_original__ : be.console[t3], s2 = arguments.length, o2 = new Array(s2 > 1 ? s2 - 1 : 0), a2 = 1; s2 > a2; a2++) o2[a2 - 1] = arguments[a2];
        r3(e2, ...o2);
      }
    }, debug() {
      for (var e3 = arguments.length, t3 = new Array(e3), i3 = 0; e3 > i3; i3++) t3[i3] = arguments[i3];
      r2._log("debug", ...t3);
    }, info() {
      for (var e3 = arguments.length, t3 = new Array(e3), i3 = 0; e3 > i3; i3++) t3[i3] = arguments[i3];
      r2._log("log", ...t3);
    }, warn() {
      for (var e3 = arguments.length, t3 = new Array(e3), i3 = 0; e3 > i3; i3++) t3[i3] = arguments[i3];
      r2._log("warn", ...t3);
    }, error() {
      for (var e3 = arguments.length, t3 = new Array(e3), i3 = 0; e3 > i3; i3++) t3[i3] = arguments[i3];
      r2._log("error", ...t3);
    }, critical() {
      for (var t3 = arguments.length, i3 = new Array(t3), r3 = 0; t3 > r3; r3++) i3[r3] = arguments[r3];
      console.error(e2, ...i3);
    }, uninitializedWarning(e3) {
      r2.error("You must initialize PostHog before calling " + e3);
    }, createLogger: (t3, i3) => Cr(e2 + " " + t3, i3) };
    return r2;
  };
  var Tr = Cr("[PostHog.js]");
  var Fr = Tr.createLogger;
  function Rr(e2, t2) {
    st(e2) && e2.forEach(t2);
  }
  function Lr(e2, t2) {
    if (!_t(e2)) if (st(e2)) e2.forEach(t2);
    else if (vt(e2)) e2.forEach((e3, i3) => t2(e3, i3));
    else for (var i2 in e2) it.call(e2, i2) && t2(e2[i2], i2);
  }
  var Mr = function(e2) {
    for (var t2 = arguments.length, i2 = new Array(t2 > 1 ? t2 - 1 : 0), r2 = 1; t2 > r2; r2++) i2[r2 - 1] = arguments[r2];
    for (var s2 of i2) for (var n2 in s2) void 0 !== s2[n2] && (e2[n2] = s2[n2]);
    return e2;
  };
  function Ar(e2) {
    for (var t2 = Object.keys(e2), i2 = t2.length, r2 = new Array(i2); i2--; ) r2[i2] = [t2[i2], e2[t2[i2]]];
    return r2;
  }
  var $r = function(e2) {
    try {
      return e2();
    } catch (e3) {
      return;
    }
  };
  var Or = function(e2) {
    return function() {
      try {
        for (var t2 = arguments.length, i2 = new Array(t2), r2 = 0; t2 > r2; r2++) i2[r2] = arguments[r2];
        return e2.apply(this, i2);
      } catch (e3) {
        Tr.critical("Implementation error. Please turn on debug mode and open a ticket on https://app.posthog.com/home#panel=support%3Asupport%3A."), Tr.critical(e3);
      }
    };
  };
  var Dr = function(e2) {
    var t2 = {};
    return Lr(e2, function(e3, i2) {
      (ut(e3) && e3.length > 0 || ht(e3)) && (t2[i2] = e3);
    }), t2;
  };
  var Nr = ["herokuapp.com", "vercel.app", "netlify.app"];
  function Br(e2) {
    var t2 = null == e2 ? void 0 : e2.hostname;
    if (!ut(t2)) return false;
    var i2 = t2.split(".").slice(-2).join(".");
    for (var r2 of Nr) if (i2 === r2) return false;
    return true;
  }
  function qr(e2, t2, i2, r2) {
    var s2 = null != r2 ? r2 : {}, n2 = s2.capture, o2 = s2.passive;
    null == e2 || e2.addEventListener(t2, i2, { capture: void 0 !== n2 && n2, passive: void 0 === o2 || o2 });
  }
  function Ur(e2) {
    return "ph_toolbar_internal" === e2.name;
  }
  var Hr = (e2) => {
    if (Ee) {
      try {
        for (var t2 = e2 + "=", i2 = Ee.cookie.split(";").filter((e3) => e3.length), r2 = 0; i2.length > r2; r2++) {
          for (var s2 = i2[r2]; " " == s2.charAt(0); ) s2 = s2.substring(1, s2.length);
          if (0 === s2.indexOf(t2)) return decodeURIComponent(s2.substring(t2.length, s2.length));
        }
      } catch (e3) {
      }
      return null;
    }
  };
  Math.trunc || (Math.trunc = function(e2) {
    return 0 > e2 ? Math.ceil(e2) : Math.floor(e2);
  }), Number.isInteger || (Number.isInteger = function(e2) {
    return ht(e2) && isFinite(e2) && Math.floor(e2) === e2;
  });
  var zr = class _zr {
    constructor(e2) {
      if (this.bytes = e2, 16 !== e2.length) throw new TypeError("not 128-bit length");
    }
    static fromFieldsV7(e2, t2, i2, r2) {
      if (!Number.isInteger(e2) || !Number.isInteger(t2) || !Number.isInteger(i2) || !Number.isInteger(r2) || 0 > e2 || 0 > t2 || 0 > i2 || 0 > r2 || e2 > 281474976710655 || t2 > 4095 || i2 > 1073741823 || r2 > 4294967295) throw new RangeError("invalid field value");
      var s2 = new Uint8Array(16);
      return s2[0] = e2 / Math.pow(2, 40), s2[1] = e2 / Math.pow(2, 32), s2[2] = e2 / Math.pow(2, 24), s2[3] = e2 / Math.pow(2, 16), s2[4] = e2 / 256, s2[5] = e2, s2[6] = 112 | t2 >>> 8, s2[7] = t2, s2[8] = 128 | i2 >>> 24, s2[9] = i2 >>> 16, s2[10] = i2 >>> 8, s2[11] = i2, s2[12] = r2 >>> 24, s2[13] = r2 >>> 16, s2[14] = r2 >>> 8, s2[15] = r2, new _zr(s2);
    }
    toString() {
      for (var e2 = "", t2 = 0; this.bytes.length > t2; t2++) e2 = e2 + (this.bytes[t2] >>> 4).toString(16) + (15 & this.bytes[t2]).toString(16), 3 !== t2 && 5 !== t2 && 7 !== t2 && 9 !== t2 || (e2 += "-");
      if (36 !== e2.length) throw new Error("Invalid UUIDv7 was generated");
      return e2;
    }
    clone() {
      return new _zr(this.bytes.slice(0));
    }
    equals(e2) {
      return 0 === this.compareTo(e2);
    }
    compareTo(e2) {
      for (var t2 = 0; 16 > t2; t2++) {
        var i2 = this.bytes[t2] - e2.bytes[t2];
        if (0 !== i2) return Math.sign(i2);
      }
      return 0;
    }
  };
  var jr = class {
    generate() {
      var e2 = this.generateOrAbort();
      if (!lt(e2)) return e2;
      this._timestamp = 0;
      var t2 = this.generateOrAbort();
      if (lt(t2)) throw new Error("Could not generate UUID after timestamp reset");
      return t2;
    }
    generateOrAbort() {
      var e2 = Date.now();
      if (e2 > this._timestamp) this._timestamp = e2, this._resetCounter();
      else {
        if (this._timestamp >= e2 + 1e4) return;
        this._counter++, this._counter > 4398046511103 && (this._timestamp++, this._resetCounter());
      }
      return zr.fromFieldsV7(this._timestamp, Math.trunc(this._counter / Math.pow(2, 30)), this._counter & Math.pow(2, 30) - 1, this._random.nextUint32());
    }
    _resetCounter() {
      this._counter = 1024 * this._random.nextUint32() + (1023 & this._random.nextUint32());
    }
    constructor() {
      this._timestamp = 0, this._counter = 0, this._random = new Gr();
    }
  };
  var Vr;
  var Wr = (e2) => {
    if ("undefined" != typeof UUIDV7_DENY_WEAK_RNG && UUIDV7_DENY_WEAK_RNG) throw new Error("no cryptographically strong RNG available");
    for (var t2 = 0; e2.length > t2; t2++) e2[t2] = 65536 * Math.trunc(65536 * Math.random()) + Math.trunc(65536 * Math.random());
    return e2;
  };
  be && !lt(be.crypto) && crypto.getRandomValues && (Wr = (e2) => crypto.getRandomValues(e2));
  var Gr = class {
    nextUint32() {
      return this._buffer.length > this._cursor || (Wr(this._buffer), this._cursor = 0), this._buffer[this._cursor++];
    }
    constructor() {
      this._buffer = new Uint32Array(8), this._cursor = 1 / 0;
    }
  };
  var Kr = () => Qr().toString();
  var Qr = () => (Vr || (Vr = new jr())).generate();
  var Yr = "";
  var Jr = /[a-z0-9][a-z0-9-]+\.[a-z]{2,}$/i;
  var Zr = { _is_supported: () => !!Ee, _error(e2) {
    Tr.error("cookieStore error: " + e2);
  }, _get: Hr, _parse(e2) {
    var t2;
    try {
      t2 = JSON.parse(Zr._get(e2)) || {};
    } catch (e3) {
    }
    return t2;
  }, _set(e2, t2, i2, r2, s2) {
    if (!Ee) return false;
    try {
      var n2 = "", o2 = "", a2 = function(e3, t3) {
        if (t3) {
          var i3 = function(e4, t4) {
            if (void 0 === t4 && (t4 = Ee), Yr) return Yr;
            if (!t4) return "";
            if (["localhost", "127.0.0.1"].includes(e4)) return "";
            for (var i4 = e4.split("."), r4 = Math.min(i4.length, 8), s3 = "dmn_chk_" + Kr(); !Yr && r4--; ) {
              var n3 = i4.slice(r4).join("."), o3 = s3 + "=1;domain=." + n3 + ";path=/";
              t4.cookie = o3 + ";max-age=3", t4.cookie.includes(s3) && (t4.cookie = o3 + ";max-age=0", Yr = n3);
            }
            return Yr;
          }(e3);
          if (!i3) {
            var r3 = ((e4) => {
              var t4 = e4.match(Jr);
              return t4 ? t4[0] : "";
            })(e3);
            r3 !== i3 && Tr.info("Warning: cookie subdomain discovery mismatch", r3, i3), i3 = r3;
          }
          return i3 ? "; domain=." + i3 : "";
        }
        return "";
      }(Ee.location.hostname, r2);
      if (i2) {
        var l2 = /* @__PURE__ */ new Date();
        l2.setTime(l2.getTime() + 864e5 * i2), n2 = "; expires=" + l2.toUTCString();
      }
      s2 && (o2 = "; secure");
      var u2 = e2 + "=" + encodeURIComponent(JSON.stringify(t2)) + n2 + "; SameSite=Lax; path=/" + a2 + o2;
      return u2.length > 3686.4 && Tr.warn("cookieStore warning: large cookie, len=" + u2.length), Ee.cookie = u2, true;
    } catch (e3) {
      return false;
    }
  }, _remove(e2, t2) {
    if (null != Ee && Ee.cookie) try {
      Zr._set(e2, "", -1, t2);
    } catch (e3) {
      return;
    }
  } };
  var Xr = null;
  var es = { _is_supported() {
    if (!dt(Xr)) return Xr;
    var e2 = true;
    if (lt(be)) e2 = false;
    else try {
      var t2 = "__mplssupport__";
      es._set(t2, "xyz"), '"xyz"' !== es._get(t2) && (e2 = false), es._remove(t2);
    } catch (t3) {
      e2 = false;
    }
    return e2 || Tr.error("localStorage unsupported; falling back to cookie store"), Xr = e2, e2;
  }, _error(e2) {
    Tr.error("localStorage error: " + e2);
  }, _get(e2) {
    try {
      return null == be ? void 0 : be.localStorage.getItem(e2);
    } catch (e3) {
      es._error(e3);
    }
    return null;
  }, _parse(e2) {
    try {
      return JSON.parse(es._get(e2)) || {};
    } catch (e3) {
    }
    return null;
  }, _set(e2, t2) {
    try {
      return null == be || be.localStorage.setItem(e2, JSON.stringify(t2)), true;
    } catch (e3) {
      es._error(e3);
    }
    return false;
  }, _remove(e2) {
    try {
      null == be || be.localStorage.removeItem(e2);
    } catch (e3) {
      es._error(e3);
    }
  } };
  var ts = [l, "distinct_id", I, C, ie, te, Y];
  var is = {};
  var rs = { _is_supported: () => true, _error(e2) {
    Tr.error("memoryStorage error: " + e2);
  }, _get: (e2) => is[e2] || null, _parse: (e2) => is[e2] || null, _set: (e2, t2) => (is[e2] = t2, true), _remove(e2) {
    delete is[e2];
  } };
  var ss = null;
  var ns = { _is_supported() {
    if (!dt(ss)) return ss;
    if (ss = true, lt(be)) ss = false;
    else try {
      var e2 = "__support__";
      ns._set(e2, "xyz"), '"xyz"' !== ns._get(e2) && (ss = false), ns._remove(e2);
    } catch (e3) {
      ss = false;
    }
    return ss;
  }, _error(e2) {
    Tr.error("sessionStorage error: ", e2);
  }, _get(e2) {
    try {
      return null == be ? void 0 : be.sessionStorage.getItem(e2);
    } catch (e3) {
      ns._error(e3);
    }
    return null;
  }, _parse(e2) {
    try {
      return JSON.parse(ns._get(e2)) || null;
    } catch (e3) {
    }
    return null;
  }, _set(e2, t2) {
    try {
      return null == be || be.sessionStorage.setItem(e2, JSON.stringify(t2)), true;
    } catch (e3) {
      ns._error(e3);
    }
    return false;
  }, _remove(e2) {
    try {
      null == be || be.sessionStorage.removeItem(e2);
    } catch (e3) {
      ns._error(e3);
    }
  } };
  var os = class {
    constructor(e2) {
      this._instance = e2;
    }
    get _config() {
      return this._instance.config;
    }
    get consent() {
      return this._getDnt() ? 0 : this._storedConsent;
    }
    isOptedOut() {
      return this._config.cookieless_mode === ce || this.isRejected() || -1 === this.consent && this._config.cookieless_mode === ue;
    }
    isOptedIn() {
      return !this.isOptedOut();
    }
    isExplicitlyOptedOut() {
      return 0 === this.consent;
    }
    isRejected() {
      return 0 === this.consent || -1 === this.consent && this._config.opt_out_capturing_by_default;
    }
    optInOut(e2) {
      this._storage._set(this._storageKey, e2 ? 1 : 0, this._config.cookie_expiration, this._config.cross_subdomain_cookie, this._config.secure_cookie);
    }
    reset() {
      this._storage._remove(this._storageKey, this._config.cross_subdomain_cookie);
    }
    get _storageKey() {
      var e2 = this._instance.config, t2 = e2.token, i2 = e2.opt_out_capturing_cookie_prefix;
      return e2.consent_persistence_name || (i2 ? i2 + t2 : "__ph_opt_in_out_" + t2);
    }
    get _storedConsent() {
      var e2 = this._storage._get(this._storageKey);
      return Et(e2) ? 1 : Je(xt, e2) ? 0 : -1;
    }
    get _storage() {
      var e2 = this._config.opt_out_capturing_persistence_type, t2 = "localStorage" === e2 ? es : Zr;
      if (!this._persistentStore || this._persistentStore !== t2) {
        this._persistentStore = t2;
        var i2 = "localStorage" === e2 ? Zr : es;
        i2._get(this._storageKey) && (this._persistentStore._get(this._storageKey) || this.optInOut(Et(i2._get(this._storageKey))), i2._remove(this._storageKey, this._config.cross_subdomain_cookie));
      }
      return this._persistentStore;
    }
    _getDnt() {
      return !!this._config.respect_dnt && [null == Se ? void 0 : Se.doNotTrack, null == Se ? void 0 : Se.msDoNotTrack, Le.doNotTrack].some((e2) => Et(e2));
    }
  };
  function as(e2, t2) {
    var i2, r2 = null == e2 || null == (i2 = e2.config) ? void 0 : i2.get_current_url;
    if (!nt(r2)) return t2;
    try {
      var s2 = r2(t2);
      return ut(s2) && s2 ? s2 : t2;
    } catch (e3) {
      return Tr.error("Error in get_current_url, falling back to window.location.href", e3), t2;
    }
  }
  var ls = "__POSTHOG_TOOLBAR__";
  var us = 1;
  var cs = 3;
  var ds = 11;
  function _s(e2) {
    return e2 instanceof Element && (e2.id === ls || !(null == e2.closest || !e2.closest(".toolbar-global-fade-container")));
  }
  function hs(e2) {
    return !!e2 && e2.nodeType === us;
  }
  function ps(e2, t2) {
    return !!e2 && !!e2.tagName && e2.tagName.toLowerCase() === t2.toLowerCase();
  }
  function gs(e2) {
    return !!e2 && e2.nodeType === cs;
  }
  function vs(e2) {
    return !!e2 && e2.nodeType === ds && hs(e2.host);
  }
  var fs = 1e3;
  function ms(e2) {
    return e2 ? Ze(e2).split(/\s+/) : [];
  }
  function ys(e2, t2) {
    var i2 = function(e3) {
      var t3, i3 = null == be || null == (t3 = be.location) ? void 0 : t3.href;
      return lt(i3) ? void 0 : as(e3, i3);
    }(t2);
    return !!(i2 && e2 && e2.some((e3) => i2.match(e3)));
  }
  function bs(e2) {
    var t2 = "";
    switch (typeof e2.className) {
      case "string":
        t2 = e2.className;
        break;
      case "object":
        t2 = (e2.className && "baseVal" in e2.className ? e2.className.baseVal : null) || e2.getAttribute("class") || "";
        break;
      default:
        t2 = "";
    }
    return ms(t2);
  }
  function ws(e2) {
    return _t(e2) ? null : Ze(e2).split(/(\s+)/).filter((e3) => js(e3)).join("").replace(/[\r\n]/g, " ").replace(/[ ]+/g, " ").substring(0, 255);
  }
  function Ss(e2) {
    var t2 = "";
    return Os(e2) && !Ds(e2) && e2.childNodes && e2.childNodes.length && Lr(e2.childNodes, function(e3) {
      var i2;
      gs(e3) && e3.textContent && (t2 += null !== (i2 = ws(e3.textContent)) && void 0 !== i2 ? i2 : "");
    }), Ze(t2);
  }
  function Es(e2) {
    var t2;
    return lt(e2.target) ? e2.srcElement || null : null != (t2 = e2.target) && t2.shadowRoot ? e2.composedPath()[0] || null : e2.target || null;
  }
  var xs = ["a", "button", "form", "input", "select", "textarea", "label"];
  function ks(e2, t2) {
    if (lt(t2)) return true;
    var i2, r2 = function(e3) {
      if (t2.some((t3) => function(e4, t4) {
        var i3 = e4.matches || e4.matchesSelector || e4.msMatchesSelector || e4.mozMatchesSelector || e4.webkitMatchesSelector || e4.oMatchesSelector;
        try {
          return !!i3 && i3.call(e4, t4);
        } catch (e5) {
          return false;
        }
      }(e3, t3))) return { v: true };
    };
    for (var s2 of e2) if (i2 = r2(s2)) return i2.v;
    return false;
  }
  function Ps(e2) {
    var t2 = e2.parentNode;
    return !(!t2 || !hs(t2)) && t2;
  }
  var Is = [".ph-no-autocapture", "[data-ph-no-autocapture]"];
  var Cs = ["next", "previous", "prev", ">", "<"];
  var Ts = [...Cs, "+", "-", "\u2212", "\u2013"];
  var Fs = (e2, t2) => /[a-z0-9]/i.test(t2) ? e2.includes(t2) : e2 === t2;
  var Rs = [".ph-no-rageclick", ".ph-no-capture"];
  var Ls = ["", "text", "search", "email", "password", "url", "tel", "number"];
  function Ms(e2, t2) {
    if (!be || As(e2)) return false;
    var i2, r2, s2, n2, o2;
    if (gt(t2) ? (i2 = !!t2 && Rs, r2 = void 0, s2 = false) : (i2 = null !== (n2 = null == t2 ? void 0 : t2.css_selector_ignorelist) && void 0 !== n2 ? n2 : Rs, r2 = null == t2 ? void 0 : t2.content_ignorelist, s2 = null !== (o2 = null == t2 ? void 0 : t2.ignore_text_selection) && void 0 !== o2 && o2), false === i2) return false;
    if (s2 && function(e3) {
      return !(!e3 || !hs(e3)) && (!!ps(e3, "textarea") || (ps(e3, "input") ? Je(Ls, (e3.getAttribute("type") || "").toLowerCase()) : function(e4) {
        if (e4.isContentEditable) return true;
        var t3 = null == e4.getAttribute ? void 0 : e4.getAttribute("contenteditable");
        return "true" === t3 || "" === t3;
      }(e3)));
    }(e2)) return false;
    var a2 = $s(e2, false).targetElementList;
    return !function(e3, t3) {
      if (false === e3 || lt(e3)) return false;
      var i3;
      if (true === e3) i3 = Cs;
      else {
        if (!st(e3)) return false;
        if (e3.length > 10) return Tr.error("[PostHog] content_ignorelist array cannot exceed 10 items. Use css_selector_ignorelist for more complex matching."), false;
        i3 = e3.map((e4) => e4.toLowerCase());
      }
      return t3.some((e4) => {
        var t4 = e4.safeText, r3 = e4.ariaLabel;
        return i3.some((e5) => Fs(t4, e5) || Fs(r3, e5));
      });
    }(r2, a2.map((e3) => {
      var t3;
      return { safeText: Ss(e3).toLowerCase(), ariaLabel: (null == (t3 = e3.getAttribute("aria-label")) ? void 0 : t3.toLowerCase().trim()) || "" };
    })) && !ks(a2, i2);
  }
  var As = (e2) => !e2 || ps(e2, "html") || !hs(e2);
  var $s = (e2, t2) => {
    if (!be || As(e2)) return { parentIsUsefulElement: false, targetElementList: [] };
    for (var i2 = false, r2 = [e2], s2 = e2; s2.parentNode && !ps(s2, "body"); ) if (vs(s2.parentNode)) r2.push(s2.parentNode.host), s2 = s2.parentNode.host;
    else {
      var n2 = Ps(s2);
      if (!n2) break;
      if (t2 || xs.indexOf(n2.tagName.toLowerCase()) > -1) i2 = true;
      else try {
        var o2 = be.getComputedStyle(n2);
        o2 && "pointer" === o2.getPropertyValue("cursor") && (i2 = true);
      } catch (e3) {
      }
      r2.push(n2), s2 = n2;
    }
    return { parentIsUsefulElement: i2, targetElementList: r2 };
  };
  function Os(e2) {
    for (var t2 = /* @__PURE__ */ new Set(), i2 = 0, r2 = e2; r2.parentNode && !ps(r2, "body"); r2 = r2.parentNode) {
      if (i2++ >= fs || t2.has(r2)) return false;
      t2.add(r2);
      var s2 = bs(r2);
      if (Je(s2, "ph-sensitive") || Je(s2, "ph-no-capture")) return false;
    }
    if (Je(bs(e2), "ph-include")) return true;
    var n2 = e2.type || "";
    if (ut(n2)) switch (n2.toLowerCase()) {
      case "hidden":
      case "password":
        return false;
    }
    var o2 = e2.name || e2.id || "";
    return !ut(o2) || !/^cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|pwd|routing|seccode|securitycode|securitynum|socialsec|socsec|ssn/i.test(o2.replace(/[^a-zA-Z0-9]/g, ""));
  }
  function Ds(e2) {
    return !!(ps(e2, "input") && !["button", "checkbox", "submit", "reset"].includes(e2.type) || ps(e2, "select") || ps(e2, "textarea") || "true" === e2.getAttribute("contenteditable"));
  }
  var Ns = "(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})";
  var Bs = new RegExp("^(?:" + Ns + ")$");
  var qs = new RegExp(Ns);
  var Us = "\\d{3}-?\\d{2}-?\\d{4}";
  var Hs = new RegExp("^(" + Us + ")$");
  var zs = new RegExp("(" + Us + ")");
  function js(e2, t2) {
    if (void 0 === t2 && (t2 = true), _t(e2)) return false;
    if (ut(e2)) {
      if (e2 = Ze(e2), (t2 ? Bs : qs).test((e2 || "").replace(/[- ]/g, ""))) return false;
      if ((t2 ? Hs : zs).test(e2)) return false;
    }
    return true;
  }
  function Vs(e2) {
    var t2 = Ss(e2);
    return js(t2 = (t2 + " " + Ws(e2)).trim()) ? t2 : "";
  }
  function Ws(e2) {
    var t2 = "";
    return e2 && e2.childNodes && e2.childNodes.length && Lr(e2.childNodes, function(e3) {
      var i2;
      if (e3 && "span" === (null == (i2 = e3.tagName) ? void 0 : i2.toLowerCase())) try {
        var r2 = Ss(e3);
        t2 = (t2 + " " + r2).trim(), e3.childNodes && e3.childNodes.length && (t2 = (t2 + " " + Ws(e3)).trim());
      } catch (e4) {
        Tr.error("[AutoCapture]", e4);
      }
    }), t2;
  }
  function Gs(e2) {
    return e2.replace(/"|\\"/g, '\\"');
  }
  function Ks(e2) {
    var t2 = e2.attr__class;
    if (t2) return st(t2) ? t2 : ms(t2);
  }
  var Qs = Fr("[Dead Clicks]");
  var Ys = () => true;
  var Js = (e2) => {
    var t2, i2 = !(null == (t2 = e2.instance.persistence) || !t2.get_property(m)), r2 = e2.instance.config.capture_dead_clicks;
    return gt(r2) ? r2 : !!ot(r2) || i2;
  };
  var Zs = class {
    get lazyLoadedDeadClicksAutocapture() {
      return this._lazyLoadedDeadClicksAutocapture;
    }
    constructor(e2, t2, i2) {
      this.instance = e2, this.isEnabled = t2, this.onCapture = i2, this.startIfEnabledOrStop();
    }
    onRemoteConfig(e2) {
      if (e2.ok) {
        var t2 = e2.config;
        "captureDeadClicks" in t2 && (this.instance.persistence && this.instance.persistence.register({ [m]: t2.captureDeadClicks }), this.startIfEnabledOrStop());
      }
    }
    startIfEnabledOrStop() {
      this.isEnabled(this) ? this._loadScript(() => {
        this._start();
      }) : this.stop();
    }
    _loadScript(e2) {
      var t2, i2;
      null != (t2 = Le.__PosthogExtensions__) && t2.initDeadClicksAutocapture ? e2() : null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this.instance, "dead-clicks-autocapture", (t3) => {
        t3 ? Qs.error("failed to load script", t3) : e2();
      });
    }
    _start() {
      var e2;
      if (Ee) {
        if (!this._lazyLoadedDeadClicksAutocapture && null != (e2 = Le.__PosthogExtensions__) && e2.initDeadClicksAutocapture) {
          var t2 = ot(this.instance.config.capture_dead_clicks) ? i({}, this.instance.config.capture_dead_clicks) : {};
          t2.__onCapture = this.onCapture, this.onCapture && (t2.capture_dead_swipes = false), this._lazyLoadedDeadClicksAutocapture = Le.__PosthogExtensions__.initDeadClicksAutocapture(this.instance, t2), this._lazyLoadedDeadClicksAutocapture.start(Ee), Qs.info("starting...");
        }
      } else Qs.error("`document` not found. Cannot start.");
    }
    stop() {
      this._lazyLoadedDeadClicksAutocapture && (this._lazyLoadedDeadClicksAutocapture.stop(), this._lazyLoadedDeadClicksAutocapture = void 0, Qs.info("stopping..."));
    }
  };
  var Xs = Fr("[SegmentIntegration]");
  var en = "posthog-js";
  function tn(e2, t2) {
    var r2 = void 0 === t2 ? {} : t2, s2 = r2.organization, n2 = r2.projectId, o2 = r2.prefix, a2 = r2.severityAllowList, l2 = void 0 === a2 ? ["error"] : a2, u2 = r2.sendExceptionsToPostHog, c2 = void 0 === u2 || u2;
    return (t3) => {
      var r3, a3, u3, d2, _2;
      if ("*" !== l2 && !l2.includes(t3.level) || !e2.__loaded) return t3;
      t3.tags || (t3.tags = {});
      var h2 = e2.requestRouter.endpointFor("ui", "/project/" + e2.config.token + "/person/" + e2.get_distinct_id());
      t3.tags["PostHog Person URL"] = h2, e2.sessionRecordingStarted() && (t3.tags["PostHog Recording URL"] = e2.get_session_replay_url({ withTimestamp: true }));
      var p2, g2 = (null == (r3 = t3.exception) ? void 0 : r3.values) || [], v2 = g2.map((e3) => i({}, e3, { stacktrace: e3.stacktrace ? i({}, e3.stacktrace, { type: "raw", frames: (e3.stacktrace.frames || []).map((e4) => i({}, e4, { platform: "web:javascript" })) }) : void 0 })), f2 = { $exception_message: (null == (a3 = g2[0]) ? void 0 : a3.value) || t3.message, $exception_type: null == (u3 = g2[0]) ? void 0 : u3.type, $exception_level: t3.level, $exception_list: v2, $sentry_event_id: t3.event_id, $sentry_exception: t3.exception, $sentry_exception_message: (null == (d2 = g2[0]) ? void 0 : d2.value) || t3.message, $sentry_exception_type: null == (_2 = g2[0]) ? void 0 : _2.type, $sentry_tags: t3.tags };
      return s2 && n2 && (f2.$sentry_url = (o2 || "https://sentry.io/organizations/") + s2 + "/issues/?project=" + n2 + "&query=" + t3.event_id), c2 && (null == (p2 = e2.exceptions) || p2.sendExceptionEvent(f2)), t3;
    };
  }
  var rn = class {
    constructor(e2, t2, i2, r2, s2, n2) {
      this.name = en, this.setupOnce = function(o2) {
        o2(tn(e2, { organization: t2, projectId: i2, prefix: r2, severityAllowList: s2, sendExceptionsToPostHog: null == n2 || n2 }));
      };
    }
  };
  var sn = class {
    constructor(e2) {
      this._onSessionIdChange = (e3, t2, i2) => {
        i2 && (i2.noSessionId || i2.activityTimeout || i2.sessionPastMaximumLength || i2.crossTabAdoption) && (Tr.info("[PageViewManager] Session rotated, clearing pageview state", { sessionId: e3, changeReason: i2 }), this._currentPageview = void 0, this._instance.scrollManager.resetContext());
      }, this._instance = e2, this._setupSessionRotationHandler();
    }
    _setupSessionRotationHandler() {
      var e2;
      this._unsubscribeSessionId = null == (e2 = this._instance.sessionManager) ? void 0 : e2.onSessionId(this._onSessionIdChange);
    }
    destroy() {
      var e2;
      null == (e2 = this._unsubscribeSessionId) || e2.call(this), this._unsubscribeSessionId = void 0;
    }
    doPageView(e2, t2) {
      var i2, r2 = this._previousPageViewProperties(e2, t2);
      return this._currentPageview = { pathname: null !== (i2 = null == be ? void 0 : be.location.pathname) && void 0 !== i2 ? i2 : "", pageViewId: t2, timestamp: e2 }, this._instance.scrollManager.resetContext(), r2;
    }
    doPageLeave(e2) {
      var t2;
      return this._previousPageViewProperties(e2, null == (t2 = this._currentPageview) ? void 0 : t2.pageViewId);
    }
    doEvent() {
      var e2;
      return { $pageview_id: null == (e2 = this._currentPageview) ? void 0 : e2.pageViewId };
    }
    _previousPageViewProperties(e2, t2) {
      var i2 = this._currentPageview;
      if (!i2) return { $pageview_id: t2 };
      var r2 = { $pageview_id: t2, $prev_pageview_id: i2.pageViewId }, s2 = this._instance.scrollManager.getContext();
      if (s2 && !this._instance.config.disable_scroll_properties) {
        var n2 = s2.maxScrollHeight, o2 = s2.lastScrollY, a2 = s2.maxScrollY, l2 = s2.maxContentHeight, u2 = s2.lastContentY, c2 = s2.maxContentY;
        if (!(lt(n2) || lt(o2) || lt(a2) || lt(l2) || lt(u2) || lt(c2))) {
          n2 = Math.ceil(n2), o2 = Math.ceil(o2), a2 = Math.ceil(a2), l2 = Math.ceil(l2), u2 = Math.ceil(u2), c2 = Math.ceil(c2);
          var d2 = n2 > 1 ? kt(o2 / n2, 0, 1, Tr) : 1, _2 = n2 > 1 ? kt(a2 / n2, 0, 1, Tr) : 1, h2 = l2 > 1 ? kt(u2 / l2, 0, 1, Tr) : 1, p2 = l2 > 1 ? kt(c2 / l2, 0, 1, Tr) : 1;
          r2 = Mr(r2, { $prev_pageview_last_scroll: o2, $prev_pageview_last_scroll_percentage: d2, $prev_pageview_max_scroll: a2, $prev_pageview_max_scroll_percentage: _2, $prev_pageview_last_content: u2, $prev_pageview_last_content_percentage: h2, $prev_pageview_max_content: c2, $prev_pageview_max_content_percentage: p2 });
        }
      }
      return i2.pathname && (r2.$prev_pageview_pathname = i2.pathname), i2.timestamp && (r2.$prev_pageview_duration = (e2.getTime() - i2.timestamp.getTime()) / 1e3), r2;
    }
  };
  var nn = ["flags", "surveys"];
  var on = { [a]: { exposure: "hidden" }, [c]: { exposure: "hidden" }, __cmpns: { exposure: "hidden" }, [d]: { exposure: "hidden" }, [_]: { exposure: "event" }, [h]: { exposure: "hidden" }, [p]: { exposure: "event" }, [g]: { exposure: "hidden" }, [v]: { exposure: "event" }, [f]: { exposure: "event" }, [m]: { exposure: "event" }, [y]: { exposure: "hidden" }, [b]: { exposure: "event" }, [w]: { exposure: "hidden" }, $session_recording_enabled_server_side: { exposure: "hidden" }, [I]: { exposure: "hidden" }, [C]: { exposure: "event" }, [S]: { exposure: "event", shouldSkipFromEventProperties: (e2) => dt(e2) }, $session_past_minimum_duration: { exposure: "event" }, $session_recording_url_trigger_activated_session: { exposure: "event" }, $session_recording_event_trigger_activated_session: { exposure: "event" }, $debug_first_full_snapshot_timestamp: { exposure: "event" }, $sess_rec_flush_size: { exposure: "hidden" }, [T]: { exposure: "derived", storageGroup: "flags", shouldSkipFromEventProperties: (e2, t2) => t2(), transformToEventProperties(e2) {
    if (!ot(e2)) return {};
    for (var t2 = {}, i2 = Object.keys(e2), r2 = 0; i2.length > r2; r2++) t2["$feature/" + i2[r2]] = e2[i2[r2]];
    return t2;
  } }, [F]: { exposure: "event", storageGroup: "flags" }, [R]: { exposure: "hidden" }, [L]: { exposure: "hidden", storageGroup: "flags" }, [M]: { exposure: "event", storageGroup: "flags" }, [A]: { exposure: "event", storageGroup: "flags", volatile: true }, [O]: { exposure: "hidden", storageGroup: "flags" }, [D]: { exposure: "event" }, [N]: { exposure: "hidden" }, [B]: { exposure: "hidden" }, [q]: { exposure: "hidden" }, [U]: { exposure: "hidden", storageGroup: "surveys" }, [H]: { exposure: "hidden", storageGroup: "surveys", volatile: true }, [z]: { exposure: "event" }, [j]: { exposure: "hidden" }, [V]: { exposure: "hidden" }, $product_tours_activated: { exposure: "hidden" }, $product_tours_activated_session: { exposure: "hidden" }, $conversations_widget_session_id: { exposure: "event" }, $conversations_ticket_id: { exposure: "event" }, $conversations_widget_state: { exposure: "event" }, $conversations_user_traits: { exposure: "event" }, [W]: { exposure: "hidden" }, [G]: { exposure: "hidden" }, [K]: { exposure: "hidden" }, [Q]: { exposure: "hidden", storageGroup: "flags", volatile: true }, [Y]: { exposure: "hidden" }, [J]: { exposure: "hidden" }, [Z]: { exposure: "hidden" }, [X]: { exposure: "hidden" }, [ee]: { exposure: "hidden" }, [te]: { exposure: "hidden" }, [ie]: { exposure: "hidden" }, [E]: { exposure: "event" }, [x]: { exposure: "event" }, [k]: { exposure: "event" }, [P]: { exposure: "event" }, [ne]: { exposure: "event" }, [oe]: { exposure: "event" }, [ae]: { exposure: "event" }, $sdk_debug_replay_event_trigger_status: { exposure: "event" }, $sdk_debug_replay_linked_flag_trigger_status: { exposure: "event" }, $sdk_debug_replay_matched_recording_trigger_groups: { exposure: "event" }, $sdk_debug_replay_remote_trigger_matching_config: { exposure: "event" }, $sdk_debug_replay_trigger_groups_count: { exposure: "event" }, $sdk_debug_replay_url_trigger_status: { exposure: "event" }, $session_recording_start_reason: { exposure: "event" } };
  var an = [["$posthog_sr_group_event_trigger_", { exposure: "hidden" }], ["$posthog_sr_group_url_trigger_", { exposure: "hidden" }], ["$posthog_sr_group_sampling_", { exposure: "hidden" }]];
  var ln = (e2) => {
    var t2 = on[e2];
    if (t2) return t2;
    for (var i2 of an) {
      var r2 = i2[1];
      if (0 === e2.indexOf(i2[0])) return r2;
    }
  };
  var un = (e2, t2) => {
    try {
      return JSON.stringify(e2, (e3, t3) => "bigint" == typeof t3 ? t3.toString() : t3, t2);
    } catch (t3) {
      return et(e2);
    }
  };
  var cn = (e2) => {
    var t2 = null == Ee ? void 0 : Ee.createElement("a");
    return lt(t2) ? null : (t2.href = e2, t2);
  };
  var dn = function(e2, t2) {
    for (var i2, r2 = ((e2.split("#")[0] || "").split(/\?(.*)/)[1] || "").replace(/^\?+/g, "").split("&"), s2 = 0; r2.length > s2; s2++) {
      var n2 = r2[s2].split("=");
      if (n2[0] === t2) {
        i2 = n2;
        break;
      }
    }
    if (!st(i2) || 2 > i2.length) return "";
    var o2 = i2[1];
    try {
      o2 = decodeURIComponent(o2);
    } catch (e3) {
      Tr.error("Skipping decoding for malformed query param: " + o2);
    }
    return o2.replace(/\+/g, " ");
  };
  var _n = function(e2, t2, i2) {
    if (!e2 || !t2 || !t2.length) return e2;
    for (var r2 = e2.split("#"), s2 = r2[1], n2 = (r2[0] || "").split("?"), o2 = n2[1], a2 = n2[0], l2 = (o2 || "").split("&"), u2 = [], c2 = 0; l2.length > c2; c2++) {
      var d2 = l2[c2].split("=");
      st(d2) && (t2.includes(d2[0]) ? u2.push(d2[0] + "=" + i2) : u2.push(l2[c2]));
    }
    var _2 = a2;
    return null != o2 && (_2 += "?" + u2.join("&")), null != s2 && (_2 += "#" + s2), _2;
  };
  var hn = function(e2, t2) {
    var i2 = e2.match(new RegExp(t2 + "=([^&]*)"));
    return i2 ? i2[1] : null;
  };
  var pn = (e2, t2) => e2 >= t2 && Fe();
  var gn = (e2, t2, i2, r2) => {
    if (0 === e2) {
      if (Fe()) {
        var s2 = t2 + 1;
        return s2 === i2 && r2(), s2;
      }
      return t2;
    }
    return 0;
  };
  var vn = "https?://(.*)";
  var fn = ["gclid", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx"];
  var mn = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gad_source", "mc_cid", ...fn];
  var yn = "<masked>";
  var bn = ["li_fat_id"];
  function wn(e2, t2, i2) {
    if (!Ee) return {};
    var r2, s2 = t2 ? [...fn, ...i2 || []] : [], n2 = Sn(_n(Ee.URL, s2, yn), e2), o2 = (r2 = {}, Lr(bn, function(e3) {
      var t3 = Hr(e3);
      r2[e3] = t3 || null;
    }), r2);
    return Mr(o2, n2);
  }
  function Sn(e2, t2) {
    var i2 = mn.concat(t2 || []), r2 = {};
    return Lr(i2, function(t3) {
      var i3 = dn(e2, t3);
      r2[t3] = i3 || null;
    }), r2;
  }
  function En(e2) {
    var t2 = function(e3) {
      return e3 ? 0 === e3.search(vn + "google.([^/?]*)") ? "google" : 0 === e3.search(vn + "bing.com") ? "bing" : 0 === e3.search(vn + "yahoo.com") ? "yahoo" : 0 === e3.search(vn + "duckduckgo.com") ? "duckduckgo" : null : null;
    }(e2), i2 = "yahoo" != t2 ? "q" : "p", r2 = {};
    if (!dt(t2)) {
      r2.$search_engine = t2;
      var s2 = Ee ? dn(Ee.referrer, i2) : "";
      s2.length && (r2.ph_keyword = s2);
    }
    return r2;
  }
  function xn() {
    return navigator.language || navigator.userLanguage;
  }
  var kn = "$direct";
  function Pn() {
    return (null == Ee ? void 0 : Ee.referrer) || kn;
  }
  function In(e2, t2, i2) {
    void 0 === i2 && (i2 = false);
    var r2 = e2 ? [...fn, ...t2 || []] : [], s2 = i2 ? Mi(null == xe ? void 0 : xe.href) : null == xe ? void 0 : xe.href, n2 = null == s2 ? void 0 : s2.substring(0, 1e3);
    return { r: Pn().substring(0, 1e3), u: n2 ? _n(n2, r2, yn) : void 0 };
  }
  function Cn(e2, t2) {
    var i2;
    void 0 === t2 && (t2 = false);
    var r2 = e2.r, s2 = e2.u, n2 = t2 ? Mi(s2) : s2, o2 = { $referrer: r2, $referring_domain: null == r2 ? void 0 : r2 == kn ? kn : null == (i2 = cn(r2)) ? void 0 : i2.host };
    if (n2) {
      o2.$current_url = n2;
      var a2 = cn(n2);
      o2.$host = null == a2 ? void 0 : a2.host, o2.$pathname = null == a2 ? void 0 : a2.pathname;
      var l2 = Sn(n2);
      Mr(o2, l2);
    }
    if (r2) {
      var u2 = En(r2);
      Mr(o2, u2);
    }
    return o2;
  }
  function Tn() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e2) {
      return;
    }
  }
  function Fn() {
    try {
      return (/* @__PURE__ */ new Date()).getTimezoneOffset();
    } catch (e2) {
      return;
    }
  }
  var Rn = { flags: Q, surveys: H };
  var Ln = ["cookie", "localstorage", "localstorage+cookie", "sessionstorage", "memory"];
  var Mn = "main";
  var An = class {
    constructor(e2, t2, r2) {
      if (void 0 === r2 && (r2 = true), this._slotState = {}, this._splitStorageEligible = false, this._splitStorage = false, this._config = e2, this._ownsSplitStorage = r2, this.props = {}, this._campaign_params_saved = false, this._name = ((e3) => {
        var t3 = "";
        return e3.token && (t3 = e3.token.replace(/\+/g, "PL").replace(/\//g, "SL").replace(/=/g, "EQ")), e3.persistence_name ? "ph_" + e3.persistence_name : "ph_" + t3 + "_posthog";
      })(e2), this._storage = this._buildStorage(e2), this._splitStorage = this._resolveSplitStorage(e2), this.load(), e2.debug && Tr.info("Persistence loaded", e2.persistence, i({}, this.props)), this.update_config(e2, e2, t2), this.save(), be) {
        var s2 = () => this.flush();
        qr(be, "beforeunload", s2, { capture: false }), qr(be, "pagehide", s2, { capture: false });
      }
    }
    _saveDebounceMs() {
      var e2, t2 = null == (e2 = this._config) ? void 0 : e2.persistence_save_debounce_ms;
      return ht(t2) && t2 > 0 ? t2 : 0;
    }
    isDisabled() {
      return !!this._disabled;
    }
    _buildStorage(e2) {
      -1 === Ln.indexOf(e2.persistence.toLowerCase()) && (Tr.critical("Unknown persistence type " + e2.persistence + "; falling back to localStorage+cookie"), e2.persistence = "localStorage+cookie");
      var t2, r2 = function(e3, t3) {
        void 0 === e3 && (e3 = []), void 0 === t3 && (t3 = false);
        var r3 = [...ts, ...e3];
        return i({}, es, { _parse(e4) {
          try {
            var i2 = {};
            try {
              i2 = Zr._parse(e4) || {};
            } catch (e5) {
            }
            var r4, s3 = JSON.parse(es._get(e4) || "{}");
            if (t3) {
              var n3 = {};
              for (var o2 in i2) {
                var a2 = i2[o2];
                dt(a2) || "" === a2 || (n3[o2] = a2);
              }
              r4 = Mr(s3, n3);
            } else r4 = Mr(i2, s3);
            return es._set(e4, r4), r4;
          } catch (e5) {
          }
          return null;
        }, _set(e4, t4, i2, s3, n3, o2) {
          var a2 = es._set(e4, t4, void 0, void 0, o2);
          try {
            var l2 = {};
            r3.forEach((e5) => {
              t4[e5] && (l2[e5] = t4[e5]);
            }), Object.keys(l2).length && Zr._set(e4, l2, i2, s3, n3, o2);
          } catch (e5) {
            es._error(e5);
          }
          return a2;
        }, _remove(e4, t4) {
          try {
            null == be || be.localStorage.removeItem(e4), Zr._remove(e4, t4);
          } catch (e5) {
            es._error(e5);
          }
        } });
      }(e2.cookie_persisted_properties || [], e2.__preview_cookie_wins_on_conflict || false), s2 = false, n2 = e2.persistence.toLowerCase();
      return "localstorage" === n2 && es._is_supported() ? (t2 = es, s2 = true) : "localstorage+cookie" === n2 && r2._is_supported() ? (t2 = r2, s2 = true) : "sessionstorage" === n2 && ns._is_supported() ? t2 = ns : "memory" === n2 ? t2 = rs : "cookie" === n2 ? t2 = Zr : r2._is_supported() ? (t2 = r2, s2 = true) : t2 = Zr, this._splitStorageEligible = s2, t2;
    }
    _groupEntryName(e2) {
      return this._name + "__" + e2;
    }
    _resolveSplitStorage(e2) {
      return this._splitStorageEligible && !!e2.split_storage;
    }
    _isFeatureFlagCacheStale(e2) {
      var t2 = null != e2 ? e2 : this._config.feature_flag_cache_ttl_ms;
      if (!t2 || 0 >= t2) return false;
      var i2 = this.props[Q];
      return !i2 || "number" != typeof i2 || Date.now() - i2 > t2;
    }
    properties() {
      var e2 = {};
      return Lr(this.props, (t2, i2) => {
        var r2 = ln(i2);
        if ("derived" === (null == r2 ? void 0 : r2.exposure)) {
          if (null != r2.shouldSkipFromEventProperties && r2.shouldSkipFromEventProperties(t2, i2 === T ? () => this._isFeatureFlagCacheStale() : () => false)) return;
          r2.transformToEventProperties && Mr(e2, r2.transformToEventProperties(t2));
        } else if (!r2 || "event" === r2.exposure) {
          if (null != r2 && null != r2.shouldSkipFromEventProperties && r2.shouldSkipFromEventProperties(t2, () => false)) return;
          e2[i2] = t2;
        }
      }), e2;
    }
    load() {
      if (!this._disabled) {
        var e2 = this._storage._parse(this._name);
        e2 && (this.props = Mr({}, e2)), this._splitStorage && this._loadGroupEntries();
      }
    }
    _loadGroupEntries() {
      for (var e2 of nn) {
        var t2 = es._parse(this._groupEntryName(e2));
        if (t2 && !at(t2)) {
          var i2 = this._slotWriteState(e2);
          i2.persisted = true, this._mainCarriesGroupKey(e2) || (i2.fingerprint = this._entryFingerprint(t2, e2)), this._groupEntryIsStale(e2, t2) || Mr(this.props, t2);
        }
      }
    }
    _mainCarriesGroupKey(e2) {
      return Object.keys(this.props).some((t2) => {
        var i2;
        return (null == (i2 = ln(t2)) ? void 0 : i2.storageGroup) === e2;
      });
    }
    _groupEntryIsStale(e2, t2) {
      var i2 = Rn[e2];
      if (!i2) return false;
      var r2 = t2[i2], s2 = this.props[i2];
      return ht(r2) && ht(s2) && s2 > r2;
    }
    refreshKey(e2) {
      var t2;
      if (!this._disabled) {
        var i2 = this._splitStorage ? null == (t2 = ln(e2)) ? void 0 : t2.storageGroup : void 0, r2 = i2 ? es._parse(this._groupEntryName(i2)) : this._storage._parse(this._name);
        if (r2 && e2 in r2) this._setProp(e2, r2[e2]);
        else {
          if (i2) {
            var s2 = this._storage._parse(this._name);
            if (s2 && e2 in s2) return void this._setProp(e2, s2[e2]);
          }
          this._deleteProp(e2);
        }
      }
    }
    save() {
      if (!this._disabled) {
        var e2 = this._saveDebounceMs();
        e2 > 0 ? lt(this._pendingSaveTimer) && (this._pendingSaveTimer = setTimeout(() => {
          this._pendingSaveTimer = void 0, this._writeNow();
        }, e2)) : this._writeNow();
      }
    }
    flush() {
      lt(this._pendingSaveTimer) || (clearTimeout(this._pendingSaveTimer), this._pendingSaveTimer = void 0, this._writeNow());
    }
    _writeNow() {
      this._disabled || (this._splitStorage ? this._writeNowSplit() : this._writeEntry(this._storage, this._name, this.props, Mn));
    }
    _writeNowSplit() {
      var e2 = this._partitionProps(), t2 = e2.main, i2 = e2.groups;
      for (var r2 of (this._writeEntry(this._storage, this._name, t2, Mn), nn)) {
        var s2, n2 = i2[r2];
        (!at(n2) || null != (s2 = this._slotState[r2]) && s2.persisted) && this._writeEntry(es, this._groupEntryName(r2), n2, r2);
      }
    }
    _partitionProps() {
      var e2 = {}, t2 = { flags: {}, surveys: {} };
      return Lr(this.props, (i2, r2) => {
        var s2, n2 = null == (s2 = ln(r2)) ? void 0 : s2.storageGroup;
        n2 ? t2[n2][r2] = i2 : e2[r2] = i2;
      }), { main: e2, groups: t2 };
    }
    _entryFingerprint(e2, t2) {
      if (t2 === Mn) return JSON.stringify(e2) + "|" + this._expire_days + "|" + this._cross_subdomain + "|" + this._secure;
      var i2 = {};
      return Lr(e2, (e3, t3) => {
        var r2;
        i2[t3] = null != (r2 = ln(t3)) && r2.volatile ? "__volatile__" : e3;
      }), JSON.stringify(i2);
    }
    _writeEntry(e2, t2, i2, r2) {
      var s2 = this._slotWriteState(r2);
      if (r2 === Mn || s2.dirty || lt(s2.fingerprint)) {
        var n2;
        try {
          if ((n2 = this._entryFingerprint(i2, r2)) === s2.fingerprint) return void (s2.dirty = false);
        } catch (e3) {
          n2 = void 0;
        }
        e2._set(t2, i2, this._expire_days, this._cross_subdomain, this._secure, this._config.debug) ? (s2.dirty = false, r2 !== Mn && (s2.persisted = true), lt(n2) || (s2.fingerprint = n2)) : this._config.debug && Tr.warn('failed to persist storage entry "' + t2 + '"; will retry on next save');
      }
    }
    remove(e2) {
      var t2 = (void 0 === e2 ? {} : e2).keepGroupEntries, i2 = void 0 !== t2 && t2;
      if (lt(this._pendingSaveTimer) || (clearTimeout(this._pendingSaveTimer), this._pendingSaveTimer = void 0), this._storage._remove(this._name, false), this._storage._remove(this._name, true), !i2 && this._ownsSplitStorage) for (var r2 of nn) es._remove(this._groupEntryName(r2));
      i2 ? delete this._slotState[Mn] : this._slotState = {};
    }
    clear() {
      this.remove(), this.props = {};
    }
    register_once(e2, t2, i2) {
      if (ot(e2)) {
        lt(t2) && (t2 = "None"), this._expire_days = lt(i2) ? this._default_expiry : i2;
        var r2 = false;
        if (Lr(e2, (e3, i3) => {
          this.props.hasOwnProperty(i3) && this.props[i3] !== t2 || (this._setProp(i3, e3), r2 = true);
        }), r2) return this.save(), true;
      }
      return false;
    }
    register(e2, t2) {
      if (ot(e2)) {
        this._expire_days = lt(t2) ? this._default_expiry : t2;
        var i2 = false;
        if (Lr(e2, (t3, r2) => {
          e2.hasOwnProperty(r2) && this.props[r2] !== t3 && (this._setProp(r2, t3), i2 = true);
        }), i2) return this.save(), true;
      }
      return false;
    }
    unregister(e2) {
      e2 in this.props && (this._deleteProp(e2), this.save());
    }
    update_campaign_params() {
      if (!this._campaign_params_saved) {
        var e2 = wn(this._config.custom_campaign_params, this._config.mask_personal_data_properties, this._config.custom_personal_data_properties);
        at(Dr(e2)) || this.register(e2), this._campaign_params_saved = true;
      }
    }
    update_search_keyword() {
      var e2;
      this.register((e2 = null == Ee ? void 0 : Ee.referrer) ? En(e2) : {});
    }
    update_referrer_info() {
      var e2;
      this.register_once({ $referrer: Pn(), $referring_domain: null != Ee && Ee.referrer && (null == (e2 = cn(Ee.referrer)) ? void 0 : e2.host) || kn }, void 0);
    }
    set_initial_person_info() {
      this.props[X] || this.props[ee] || this.register_once({ [te]: In(this._config.mask_personal_data_properties, this._config.custom_personal_data_properties, this._config.disable_capture_url_hashes) }, void 0);
    }
    get_initial_props() {
      var e2 = {};
      Lr([ee, X], (t3) => {
        var i3 = this.props[t3];
        i3 && Lr(i3, function(t4, i4) {
          e2["$initial_" + Xe(i4)] = t4;
        });
      });
      var t2 = this.props[te];
      if (t2) {
        var i2 = function(e3, t3) {
          void 0 === t3 && (t3 = false);
          var i3 = Cn(e3, t3), r2 = {};
          return Lr(i3, function(e4, t4) {
            r2["$initial_" + Xe(t4)] = e4;
          }), r2;
        }(t2, this._config.disable_capture_url_hashes);
        Mr(e2, i2);
      }
      return e2;
    }
    safe_merge(e2) {
      return Lr(this.props, function(t2, i2) {
        i2 in e2 || (e2[i2] = t2);
      }), e2;
    }
    update_config(e2, t2, i2) {
      this._default_expiry = this._expire_days = e2.cookie_expiration, this.set_disabled(e2.disable_persistence || !!i2), this.set_cross_subdomain(e2.cross_subdomain_cookie), this.set_secure(e2.secure_cookie);
      var r2 = e2.persistence !== t2.persistence || !((e3, t3) => {
        if (e3.length !== t3.length) return false;
        var i3 = [...e3].sort(), r3 = [...t3].sort();
        return i3.every((e4, t4) => e4 === r3[t4]);
      })(e2.cookie_persisted_properties || [], t2.cookie_persisted_properties || []), s2 = r2 ? this._buildStorage(e2) : this._storage, n2 = this._resolveSplitStorage(e2);
      if (r2 || n2 !== this._splitStorage) {
        var o2 = this.props;
        this.clear(), this._storage = s2, this._splitStorage = n2, this.props = o2, this.save();
      }
    }
    set_disabled(e2) {
      this._disabled = e2, this._disabled ? this.remove() : this.save();
    }
    set_cross_subdomain(e2) {
      e2 !== this._cross_subdomain && (this._cross_subdomain = e2, this.remove({ keepGroupEntries: true }), this.save());
    }
    set_secure(e2) {
      e2 !== this._secure && (this._secure = e2, this.remove({ keepGroupEntries: true }), this.save());
    }
    set_event_timer(e2, t2) {
      var i2 = this.props[d] || {};
      i2[e2] = t2, this._setProp(d, i2), this.save();
    }
    remove_event_timer(e2) {
      var t2 = this.props[d] || {}, i2 = t2[e2];
      return lt(i2) || (delete t2[e2], this._setProp(d, t2), this.save()), i2;
    }
    get_property(e2) {
      return this.props[e2];
    }
    set_property(e2, t2) {
      this._setProp(e2, t2), this.save();
    }
    _setProp(e2, t2) {
      var i2;
      this.props[e2] = t2, null != (i2 = ln(e2)) && i2.volatile || this._markGroupDirty(e2);
    }
    _deleteProp(e2) {
      delete this.props[e2], this._markGroupDirty(e2);
    }
    _markGroupDirty(e2) {
      var t2, i2 = null == (t2 = ln(e2)) ? void 0 : t2.storageGroup;
      i2 && (this._slotWriteState(i2).dirty = true);
    }
    _slotWriteState(e2) {
      return this._slotState[e2] || (this._slotState[e2] = {});
    }
  };
  var $n = { Activation: "events", Cancellation: "cancelEvents" };
  var Bn = { Popover: "popover", API: "api", Widget: "widget", ExternalSurvey: "external_survey" };
  var zn = { SHOWN: "survey shown", DISMISSED: "survey dismissed", SENT: "survey sent", ABANDONED: "survey abandoned" };
  var jn = { SURVEY_ID: "$survey_id", SURVEY_NAME: "$survey_name", SURVEY_RESPONSE: "$survey_response", SURVEY_ITERATION: "$survey_iteration", SURVEY_ITERATION_START_DATE: "$survey_iteration_start_date", SURVEY_PARTIALLY_COMPLETED: "$survey_partially_completed", SURVEY_SUBMISSION_ID: "$survey_submission_id", SURVEY_QUESTIONS: "$survey_questions", SURVEY_COMPLETED: "$survey_completed", PRODUCT_TOUR_ID: "$product_tour_id", SURVEY_LAST_SEEN_DATE: "$survey_last_seen_date", SURVEY_LANGUAGE: "$survey_language" };
  var Vn = { Popover: "popover", Inline: "inline" };
  var Gn = { SHOWN: "product tour shown", DISMISSED: "product tour dismissed", COMPLETED: "product tour completed", STEP_SHOWN: "product tour step shown", STEP_COMPLETED: "product tour step completed", BUTTON_CLICKED: "product tour button clicked", STEP_SELECTOR_FAILED: "product tour step selector failed", BANNER_CONTAINER_SELECTOR_FAILED: "product tour banner container selector failed", BANNER_ACTION_CLICKED: "product tour banner action clicked" };
  var Kn = { TOUR_ID: "$product_tour_id", TOUR_NAME: "$product_tour_name", TOUR_ITERATION: "$product_tour_iteration", TOUR_RENDER_REASON: "$product_tour_render_reason", TOUR_STEP_ID: "$product_tour_step_id", TOUR_STEP_ORDER: "$product_tour_step_order", TOUR_STEP_TYPE: "$product_tour_step_type", TOUR_DISMISS_REASON: "$product_tour_dismiss_reason", TOUR_BUTTON_TEXT: "$product_tour_button_text", TOUR_BUTTON_ACTION: "$product_tour_button_action", TOUR_BUTTON_LINK: "$product_tour_button_link", TOUR_BUTTON_TOUR_ID: "$product_tour_button_tour_id", TOUR_STEPS_COUNT: "$product_tour_steps_count", TOUR_STEP_SELECTOR: "$product_tour_step_selector", TOUR_STEP_SELECTOR_FOUND: "$product_tour_step_selector_found", TOUR_STEP_ELEMENT_TAG: "$product_tour_step_element_tag", TOUR_STEP_ELEMENT_ID: "$product_tour_step_element_id", TOUR_STEP_ELEMENT_CLASSES: "$product_tour_step_element_classes", TOUR_STEP_ELEMENT_TEXT: "$product_tour_step_element_text", TOUR_ERROR: "$product_tour_error", TOUR_MATCHES_COUNT: "$product_tour_matches_count", TOUR_FAILURE_PHASE: "$product_tour_failure_phase", TOUR_WAITED_FOR_ELEMENT: "$product_tour_waited_for_element", TOUR_WAIT_DURATION_MS: "$product_tour_wait_duration_ms", TOUR_BANNER_SELECTOR: "$product_tour_banner_selector", TOUR_LINKED_SURVEY_ID: "$product_tour_linked_survey_id", USE_MANUAL_SELECTOR: "$use_manual_selector", INFERENCE_DATA_PRESENT: "$inference_data_present", TOUR_LAST_SEEN_DATE: "$product_tour_last_seen_date", TOUR_TYPE: "$product_tour_type" };
  var Qn = Fr("[RateLimiter]");
  var Yn = class {
    constructor(e2) {
      this.serverLimits = {}, this.lastEventRateLimited = false, this.checkForLimiting = (e3) => {
        var t2 = e3.text;
        if (t2 && t2.length) try {
          (JSON.parse(t2).quota_limited || []).forEach((e4) => {
            Qn.info((e4 || "events") + " is quota limited."), this.serverLimits[e4] = (/* @__PURE__ */ new Date()).getTime() + 6e4;
          });
        } catch (e4) {
          return void Qn.warn('could not rate limit - continuing. Error: "' + (null == e4 ? void 0 : e4.message) + '"', { text: t2 });
        }
      }, this.instance = e2, this.lastEventRateLimited = this.clientRateLimitContext(true).isRateLimited;
    }
    get captureEventsPerSecond() {
      var e2;
      return (null == (e2 = this.instance.config.rate_limiting) ? void 0 : e2.events_per_second) || 10;
    }
    get captureEventsBurstLimit() {
      var e2;
      return Math.max((null == (e2 = this.instance.config.rate_limiting) ? void 0 : e2.events_burst_limit) || 10 * this.captureEventsPerSecond, this.captureEventsPerSecond);
    }
    clientRateLimitContext(e2) {
      var t2, i2, r2;
      void 0 === e2 && (e2 = false);
      var s2 = this.captureEventsBurstLimit, n2 = this.captureEventsPerSecond, o2 = (/* @__PURE__ */ new Date()).getTime(), a2 = null !== (t2 = null == (i2 = this.instance.persistence) ? void 0 : i2.get_property(Z)) && void 0 !== t2 ? t2 : { tokens: s2, last: o2 };
      a2.tokens += (o2 - a2.last) / 1e3 * n2, a2.last = o2, a2.tokens > s2 && (a2.tokens = s2);
      var l2 = 1 > a2.tokens;
      return l2 || e2 || (a2.tokens = Math.max(0, a2.tokens - 1)), !l2 || this.lastEventRateLimited || e2 || this.instance.capture("$$client_ingestion_warning", { $$client_ingestion_warning_message: "posthog-js client rate limited. Config is set to " + n2 + " events per second and " + s2 + " events burst limit." }, { skip_client_rate_limiting: true }), this.lastEventRateLimited = l2, null == (r2 = this.instance.persistence) || r2.set_property(Z, a2), { isRateLimited: l2, remainingTokens: a2.tokens };
    }
    isServerRateLimited(e2) {
      var t2 = this.serverLimits[e2 || "events"] || false;
      return false !== t2 && (/* @__PURE__ */ new Date()).getTime() < t2;
    }
  };
  var Jn = Fr("[RemoteConfig]");
  var Zn = class {
    constructor(e2) {
      this._instance = e2;
    }
    get remoteConfig() {
      var e2;
      return null == (e2 = Le._POSTHOG_REMOTE_CONFIG) || null == (e2 = e2[this._instance.config.token]) ? void 0 : e2.config;
    }
    _loadRemoteConfigJs(e2) {
      var t2, i2;
      null != (t2 = Le.__PosthogExtensions__) && t2.loadExternalDependency ? null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, "remote-config", () => e2(this.remoteConfig)) : e2();
    }
    _loadRemoteConfigJSON(e2) {
      this._instance._send_request({ method: "GET", url: this._instance.requestRouter.endpointFor("assets", "/array/" + this._instance.config.token + "/config"), callback(t2) {
        e2(t2.json);
      } });
    }
    load() {
      try {
        if (this.remoteConfig) return Jn.info("Using preloaded remote config", this.remoteConfig), this._onRemoteConfig(this.remoteConfig), void this._startRefreshInterval();
        if (this._instance._shouldDisableFlags()) return void Jn.warn("Remote config is disabled. Falling back to local config.");
        this._loadRemoteConfigJs((e2) => {
          if (!e2) return Jn.info("No config found after loading remote JS config. Falling back to JSON."), void this._loadRemoteConfigJSON((e3) => {
            this._onRemoteConfig(e3), this._startRefreshInterval();
          });
          this._onRemoteConfig(e2), this._startRefreshInterval();
        });
      } catch (e2) {
        Jn.error("Error loading remote config", e2);
      }
    }
    stop() {
      this._refreshInterval && (clearInterval(this._refreshInterval), this._refreshInterval = void 0);
    }
    refresh() {
      !this._instance._shouldDisableFlags() && Ee && "hidden" !== Ee.visibilityState && this._instance.reloadFeatureFlags();
    }
    _startRefreshInterval() {
      var e2;
      if (!this._refreshInterval) {
        var t2 = null !== (e2 = this._instance.config.remote_config_refresh_interval_ms) && void 0 !== e2 ? e2 : 3e5;
        0 !== t2 && (this._refreshInterval = setInterval(() => {
          this.refresh();
        }, t2));
      }
    }
    _onRemoteConfig(e2) {
      var t2;
      e2 || Jn.error("Failed to fetch remote config from PostHog."), this._instance._onRemoteConfig(e2 ? { ok: true, config: e2 } : { ok: false }), false !== (null == e2 ? void 0 : e2.hasFeatureFlags) && (this._instance.config.advanced_disable_feature_flags_on_first_load || null == (t2 = this._instance.featureFlags) || t2.ensureFlagsLoaded());
    }
  };
  var eo = { GZipJS: "gzip-js", Base64: "base64" };
  var to = Uint8Array;
  var io = Uint16Array;
  var ro = Uint32Array;
  var so = new to([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
  var no = new to([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
  var oo = new to([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  var ao = function(e2, t2) {
    for (var i2 = new io(31), r2 = 0; 31 > r2; ++r2) i2[r2] = t2 += 1 << e2[r2 - 1];
    var s2 = new ro(i2[30]);
    for (r2 = 1; 30 > r2; ++r2) for (var n2 = i2[r2]; i2[r2 + 1] > n2; ++n2) s2[n2] = n2 - i2[r2] << 5 | r2;
    return [i2, s2];
  };
  var lo = ao(so, 2);
  var uo = lo[1];
  lo[0][28] = 258, uo[258] = 28;
  for (co = ao(no, 0)[1], _o = new io(32768), ho = 0; 32768 > ho; ++ho) {
    po = (43690 & ho) >>> 1 | (21845 & ho) << 1;
    _o[ho] = ((65280 & (po = (61680 & (po = (52428 & po) >>> 2 | (13107 & po) << 2)) >>> 4 | (3855 & po) << 4)) >>> 8 | (255 & po) << 8) >>> 1;
  }
  var po;
  var co;
  var _o;
  var ho;
  var go = function(e2, t2, i2) {
    for (var r2 = e2.length, s2 = 0, n2 = new io(t2); r2 > s2; ++s2) ++n2[e2[s2] - 1];
    var o2, a2 = new io(t2);
    for (s2 = 0; t2 > s2; ++s2) a2[s2] = a2[s2 - 1] + n2[s2 - 1] << 1;
    if (i2) {
      o2 = new io(1 << t2);
      var l2 = 15 - t2;
      for (s2 = 0; r2 > s2; ++s2) if (e2[s2]) for (var u2 = s2 << 4 | e2[s2], c2 = t2 - e2[s2], d2 = a2[e2[s2] - 1]++ << c2, _2 = d2 | (1 << c2) - 1; _2 >= d2; ++d2) o2[_o[d2] >>> l2] = u2;
    } else for (o2 = new io(r2), s2 = 0; r2 > s2; ++s2) o2[s2] = _o[a2[e2[s2] - 1]++] >>> 15 - e2[s2];
    return o2;
  };
  var vo = new to(288);
  for (ho = 0; 144 > ho; ++ho) vo[ho] = 8;
  for (ho = 144; 256 > ho; ++ho) vo[ho] = 9;
  for (ho = 256; 280 > ho; ++ho) vo[ho] = 7;
  for (ho = 280; 288 > ho; ++ho) vo[ho] = 8;
  var fo = new to(32);
  for (ho = 0; 32 > ho; ++ho) fo[ho] = 5;
  var mo = go(vo, 9, 0);
  var yo = go(fo, 5, 0);
  var bo = function(e2) {
    return (e2 / 8 >> 0) + (7 & e2 && 1);
  };
  var wo = function(e2, t2, i2) {
    (null == i2 || i2 > e2.length) && (i2 = e2.length);
    var r2 = new (e2 instanceof io ? io : e2 instanceof ro ? ro : to)(i2 - t2);
    return r2.set(e2.subarray(t2, i2)), r2;
  };
  var So = function(e2, t2, i2) {
    var r2 = t2 / 8 >> 0;
    e2[r2] |= i2 <<= 7 & t2, e2[r2 + 1] |= i2 >>> 8;
  };
  var Eo = function(e2, t2, i2) {
    var r2 = t2 / 8 >> 0;
    e2[r2] |= i2 <<= 7 & t2, e2[r2 + 1] |= i2 >>> 8, e2[r2 + 2] |= i2 >>> 16;
  };
  var xo = function(e2, t2) {
    for (var i2 = [], r2 = 0; e2.length > r2; ++r2) e2[r2] && i2.push({ s: r2, f: e2[r2] });
    var s2 = i2.length, n2 = i2.slice();
    if (!s2) return [new to(0), 0];
    if (1 == s2) {
      var o2 = new to(i2[0].s + 1);
      return o2[i2[0].s] = 1, [o2, 1];
    }
    i2.sort(function(e3, t3) {
      return e3.f - t3.f;
    }), i2.push({ s: -1, f: 25001 });
    var a2 = i2[0], l2 = i2[1], u2 = 0, c2 = 1, d2 = 2;
    for (i2[0] = { s: -1, f: a2.f + l2.f, l: a2, r: l2 }; c2 != s2 - 1; ) a2 = i2[i2[d2].f > i2[u2].f ? u2++ : d2++], l2 = i2[u2 != c2 && i2[d2].f > i2[u2].f ? u2++ : d2++], i2[c2++] = { s: -1, f: a2.f + l2.f, l: a2, r: l2 };
    var _2 = n2[0].s;
    for (r2 = 1; s2 > r2; ++r2) n2[r2].s > _2 && (_2 = n2[r2].s);
    var h2 = new io(_2 + 1), p2 = ko(i2[c2 - 1], h2, 0);
    if (p2 > t2) {
      r2 = 0;
      var g2 = 0, v2 = p2 - t2, f2 = 1 << v2;
      for (n2.sort(function(e3, t3) {
        return h2[t3.s] - h2[e3.s] || e3.f - t3.f;
      }); s2 > r2; ++r2) {
        var m2 = n2[r2].s;
        if (t2 >= h2[m2]) break;
        g2 += f2 - (1 << p2 - h2[m2]), h2[m2] = t2;
      }
      for (g2 >>>= v2; g2 > 0; ) {
        var y2 = n2[r2].s;
        t2 > h2[y2] ? g2 -= 1 << t2 - h2[y2]++ - 1 : ++r2;
      }
      for (; r2 >= 0 && g2; --r2) {
        var b2 = n2[r2].s;
        h2[b2] == t2 && (--h2[b2], ++g2);
      }
      p2 = t2;
    }
    return [new to(h2), p2];
  };
  var ko = function(e2, t2, i2) {
    return -1 == e2.s ? Math.max(ko(e2.l, t2, i2 + 1), ko(e2.r, t2, i2 + 1)) : t2[e2.s] = i2;
  };
  var Po = function(e2) {
    for (var t2 = e2.length; t2 && !e2[--t2]; ) ;
    for (var i2 = new io(++t2), r2 = 0, s2 = e2[0], n2 = 1, o2 = function(e3) {
      i2[r2++] = e3;
    }, a2 = 1; t2 >= a2; ++a2) if (e2[a2] == s2 && a2 != t2) ++n2;
    else {
      if (!s2 && n2 > 2) {
        for (; n2 > 138; n2 -= 138) o2(32754);
        n2 > 2 && (o2(n2 > 10 ? n2 - 11 << 5 | 28690 : n2 - 3 << 5 | 12305), n2 = 0);
      } else if (n2 > 3) {
        for (o2(s2), --n2; n2 > 6; n2 -= 6) o2(8304);
        n2 > 2 && (o2(n2 - 3 << 5 | 8208), n2 = 0);
      }
      for (; n2--; ) o2(s2);
      n2 = 1, s2 = e2[a2];
    }
    return [i2.subarray(0, r2), t2];
  };
  var Io = function(e2, t2) {
    for (var i2 = 0, r2 = 0; t2.length > r2; ++r2) i2 += e2[r2] * t2[r2];
    return i2;
  };
  var Co = function(e2, t2, i2) {
    var r2 = i2.length, s2 = bo(t2 + 2);
    e2[s2] = 255 & r2, e2[s2 + 1] = r2 >>> 8, e2[s2 + 2] = 255 ^ e2[s2], e2[s2 + 3] = 255 ^ e2[s2 + 1];
    for (var n2 = 0; r2 > n2; ++n2) e2[s2 + n2 + 4] = i2[n2];
    return 8 * (s2 + 4 + r2);
  };
  var To = function(e2, t2, i2, r2, s2, n2, o2, a2, l2, u2, c2) {
    So(t2, c2++, i2), ++s2[256];
    for (var d2 = xo(s2, 15), _2 = d2[0], h2 = d2[1], p2 = xo(n2, 15), g2 = p2[0], v2 = p2[1], f2 = Po(_2), m2 = f2[0], y2 = f2[1], b2 = Po(g2), w2 = b2[0], S2 = b2[1], E2 = new io(19), x2 = 0; m2.length > x2; ++x2) E2[31 & m2[x2]]++;
    for (x2 = 0; w2.length > x2; ++x2) E2[31 & w2[x2]]++;
    for (var k2 = xo(E2, 7), P2 = k2[0], I2 = k2[1], C2 = 19; C2 > 4 && !P2[oo[C2 - 1]]; --C2) ;
    var T2, F2, R2, L2, M2 = u2 + 5 << 3, A2 = Io(s2, vo) + Io(n2, fo) + o2, O2 = Io(s2, _2) + Io(n2, g2) + o2 + 14 + 3 * C2 + Io(E2, P2) + (2 * E2[16] + 3 * E2[17] + 7 * E2[18]);
    if (A2 >= M2 && O2 >= M2) return Co(t2, c2, e2.subarray(l2, l2 + u2));
    if (So(t2, c2, 1 + (A2 > O2)), c2 += 2, A2 > O2) {
      T2 = go(_2, h2, 0), F2 = _2, R2 = go(g2, v2, 0), L2 = g2;
      var D2 = go(P2, I2, 0);
      for (So(t2, c2, y2 - 257), So(t2, c2 + 5, S2 - 1), So(t2, c2 + 10, C2 - 4), c2 += 14, x2 = 0; C2 > x2; ++x2) So(t2, c2 + 3 * x2, P2[oo[x2]]);
      c2 += 3 * C2;
      for (var N2 = [m2, w2], B2 = 0; 2 > B2; ++B2) {
        var q2 = N2[B2];
        for (x2 = 0; q2.length > x2; ++x2) So(t2, c2, D2[U2 = 31 & q2[x2]]), c2 += P2[U2], U2 > 15 && (So(t2, c2, q2[x2] >>> 5 & 127), c2 += q2[x2] >>> 12);
      }
    } else T2 = mo, F2 = vo, R2 = yo, L2 = fo;
    for (x2 = 0; a2 > x2; ++x2) if (r2[x2] > 255) {
      var U2;
      Eo(t2, c2, T2[257 + (U2 = r2[x2] >>> 18 & 31)]), c2 += F2[U2 + 257], U2 > 7 && (So(t2, c2, r2[x2] >>> 23 & 31), c2 += so[U2]);
      var H2 = 31 & r2[x2];
      Eo(t2, c2, R2[H2]), c2 += L2[H2], H2 > 3 && (Eo(t2, c2, r2[x2] >>> 5 & 8191), c2 += no[H2]);
    } else Eo(t2, c2, T2[r2[x2]]), c2 += F2[r2[x2]];
    return Eo(t2, c2, T2[256]), c2 + F2[256];
  };
  var Fo = new ro([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
  var Ro = function() {
    for (var e2 = new ro(256), t2 = 0; 256 > t2; ++t2) {
      for (var i2 = t2, r2 = 9; --r2; ) i2 = (1 & i2 && 3988292384) ^ i2 >>> 1;
      e2[t2] = i2;
    }
    return e2;
  }();
  var Lo = function(e2, t2, i2) {
    for (; i2; ++t2) e2[t2] = i2, i2 >>>= 8;
  };
  function Mo(e2, t2) {
    void 0 === t2 && (t2 = {});
    var i2 = /* @__PURE__ */ function() {
      var e3 = 4294967295;
      return { p(t3) {
        for (var i3 = e3, r3 = 0; t3.length > r3; ++r3) i3 = Ro[255 & i3 ^ t3[r3]] ^ i3 >>> 8;
        e3 = i3;
      }, d() {
        return 4294967295 ^ e3;
      } };
    }(), r2 = e2.length;
    i2.p(e2);
    var s2, n2, o2, a2, l2, u2 = (a2 = 10 + ((s2 = t2).filename && s2.filename.length + 1 || 0), l2 = 8, function(e3, t3, i3, r3, s3, n3) {
      var o3 = e3.length, a3 = new to(r3 + o3 + 5 * (1 + Math.floor(o3 / 7e3)) + s3), l3 = a3.subarray(r3, a3.length - s3), u3 = 0;
      if (!t3 || 8 > o3) for (var c3 = 0; o3 >= c3; c3 += 65535) {
        var d2 = c3 + 65535;
        o3 > d2 ? u3 = Co(l3, u3, e3.subarray(c3, d2)) : (l3[c3] = true, u3 = Co(l3, u3, e3.subarray(c3, o3)));
      }
      else {
        for (var _2 = Fo[t3 - 1], h2 = _2 >>> 13, p2 = 8191 & _2, g2 = (1 << i3) - 1, v2 = new io(32768), f2 = new io(g2 + 1), m2 = Math.ceil(i3 / 3), y2 = 2 * m2, b2 = function(t4) {
          return (e3[t4] ^ e3[t4 + 1] << m2 ^ e3[t4 + 2] << y2) & g2;
        }, w2 = new ro(25e3), S2 = new io(288), E2 = new io(32), x2 = 0, k2 = 0, P2 = (c3 = 0, 0), I2 = 0, C2 = 0; o3 > c3; ++c3) {
          var T2 = b2(c3), F2 = 32767 & c3, R2 = f2[T2];
          if (v2[F2] = R2, f2[T2] = F2, c3 >= I2) {
            var L2 = o3 - c3;
            if ((x2 > 7e3 || P2 > 24576) && L2 > 423) {
              u3 = To(e3, l3, 0, w2, S2, E2, k2, P2, C2, c3 - C2, u3), P2 = x2 = k2 = 0, C2 = c3;
              for (var M2 = 0; 286 > M2; ++M2) S2[M2] = 0;
              for (M2 = 0; 30 > M2; ++M2) E2[M2] = 0;
            }
            var A2 = 2, O2 = 0, D2 = p2, N2 = F2 - R2 & 32767;
            if (L2 > 2 && T2 == b2(c3 - N2)) for (var B2 = Math.min(h2, L2) - 1, q2 = Math.min(32767, c3), U2 = Math.min(258, L2); q2 >= N2 && --D2 && F2 != R2; ) {
              if (e3[c3 + A2] == e3[c3 + A2 - N2]) {
                for (var H2 = 0; U2 > H2 && e3[c3 + H2] == e3[c3 + H2 - N2]; ++H2) ;
                if (H2 > A2) {
                  if (A2 = H2, O2 = N2, H2 > B2) break;
                  var z2 = Math.min(N2, H2 - 2), j2 = 0;
                  for (M2 = 0; z2 > M2; ++M2) {
                    var V2 = c3 - N2 + M2 + 32768 & 32767, W2 = V2 - v2[V2] + 32768 & 32767;
                    W2 > j2 && (j2 = W2, R2 = V2);
                  }
                }
              }
              N2 += (F2 = R2) - (R2 = v2[F2]) + 32768 & 32767;
            }
            if (O2) {
              w2[P2++] = 268435456 | uo[A2] << 18 | co[O2];
              var G2 = 31 & uo[A2], K2 = 31 & co[O2];
              k2 += so[G2] + no[K2], ++S2[257 + G2], ++E2[K2], I2 = c3 + A2, ++x2;
            } else w2[P2++] = e3[c3], ++S2[e3[c3]];
          }
        }
        u3 = To(e3, l3, true, w2, S2, E2, k2, P2, C2, c3 - C2, u3);
      }
      return wo(a3, 0, r3 + bo(u3) + s3);
    }(n2 = e2, null == (o2 = t2).level ? 6 : o2.level, null == o2.mem ? Math.ceil(1.5 * Math.max(8, Math.min(13, Math.log(n2.length)))) : 12 + o2.mem, a2, l2)), c2 = u2.length;
    return function(e3, t3) {
      var i3 = t3.filename;
      if (e3[0] = 31, e3[1] = 139, e3[2] = 8, e3[8] = 2 > t3.level ? 4 : 9 == t3.level ? 2 : 0, e3[9] = 3, 0 != t3.mtime && Lo(e3, 4, Math.floor(new Date(t3.mtime || Date.now()) / 1e3)), i3) {
        e3[3] = 8;
        for (var r3 = 0; i3.length >= r3; ++r3) e3[r3 + 10] = i3.charCodeAt(r3);
      }
    }(u2, t2), Lo(u2, c2 - 8, i2.d()), Lo(u2, c2 - 4, r2), u2;
  }
  var Ao = !!Pe || !!ke;
  var $o = "text/plain";
  var Oo = false;
  var Do = (e2, t2) => {
    var i2 = e2.split("#"), r2 = i2[1], s2 = i2[0].split("?"), n2 = s2[0], o2 = s2[1];
    if (!o2) return e2;
    var a2 = o2.split("&").filter((e3) => e3.split("=")[0] !== t2).join("&");
    return n2 + (a2 ? "?" + a2 : "") + (r2 ? "#" + r2 : "");
  };
  var No = function(e2, t2, r2) {
    var s2;
    void 0 === r2 && (r2 = true);
    var n2 = e2.split("?"), o2 = n2[0], a2 = n2[1], l2 = i({}, t2), u2 = null !== (s2 = null == a2 ? void 0 : a2.split("&").map((e3) => {
      var t3, i2 = e3.split("="), s3 = i2[0], n3 = r2 && null !== (t3 = l2[s3]) && void 0 !== t3 ? t3 : i2[1];
      return delete l2[s3], s3 + "=" + n3;
    })) && void 0 !== s2 ? s2 : [], c2 = function(e3, t3) {
      var i2, r3;
      void 0 === t3 && (t3 = "&");
      var s3 = [];
      return Lr(e3, function(e4, t4) {
        lt(e4) || lt(t4) || "undefined" === t4 || (i2 = encodeURIComponent(((e5) => e5 instanceof File)(e4) ? e4.name : e4.toString()), r3 = encodeURIComponent(t4), s3[s3.length] = r3 + "=" + i2);
      }), s3.join(t3);
    }(l2);
    return c2 && u2.push(c2), u2.length > 0 ? o2 + "?" + u2.join("&") : o2;
  };
  var Bo = (e2) => {
    if (e2._encodedBody) return e2._encodedBody;
    var t2 = e2.data, i2 = e2.compression;
    if (t2) {
      if (i2 === eo.GZipJS) {
        var r2 = Mo(function(e3, t3) {
          var i3 = e3.length;
          if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(e3);
          for (var r3 = new to(e3.length + (e3.length >>> 1)), s3 = 0, n3 = function(e4) {
            r3[s3++] = e4;
          }, o3 = 0; i3 > o3; ++o3) {
            if (s3 + 5 > r3.length) {
              var a2 = new to(s3 + 8 + (i3 - o3 << 1));
              a2.set(r3), r3 = a2;
            }
            var l2 = e3.charCodeAt(o3);
            128 > l2 ? n3(l2) : 2048 > l2 ? (n3(192 | l2 >>> 6), n3(128 | 63 & l2)) : l2 > 55295 && 57344 > l2 ? (n3(240 | (l2 = 65536 + (1047552 & l2) | 1023 & e3.charCodeAt(++o3)) >>> 18), n3(128 | l2 >>> 12 & 63), n3(128 | l2 >>> 6 & 63), n3(128 | 63 & l2)) : (n3(224 | l2 >>> 12), n3(128 | l2 >>> 6 & 63), n3(128 | 63 & l2));
          }
          return wo(r3, 0, s3);
        }(un(t2)), { mtime: 0 });
        return { contentType: $o, body: r2.buffer.slice(r2.byteOffset, r2.byteOffset + r2.byteLength), estimatedSize: r2.byteLength };
      }
      if (i2 === eo.Base64) {
        var s2 = function(e3) {
          return e3 ? btoa(encodeURIComponent(e3).replace(/%([0-9A-F]{2})/g, (e4, t3) => String.fromCharCode(parseInt(t3, 16)))) : e3;
        }(un(t2)), n2 = ((e3) => "data=" + encodeURIComponent("string" == typeof e3 ? e3 : un(e3)))(s2);
        return { contentType: "application/x-www-form-urlencoded", body: n2, estimatedSize: new Blob([n2]).size };
      }
      var o2 = un(t2);
      return { contentType: "application/json", body: o2, estimatedSize: new Blob([o2]).size };
    }
  };
  var qo = (e2) => {
    var t2, r2, s2 = () => "sendBeacon" === e2.transport ? { url: No(e2.url, { compression: eo.Base64 }), encodedBody: Bo(i({}, e2, { compression: eo.Base64, _encodedBody: void 0 })) } : { url: Do(e2.url, "compression"), encodedBody: Bo(i({}, e2, { compression: void 0, _encodedBody: void 0 })) };
    try {
      t2 = Bo(e2);
    } catch (t3) {
      if (je(e2.compression, dn(e2.url, "compression"))) return Tr.error("Failed to gzip request body, sending uncompressed payload", t3), s2();
      throw t3;
    }
    return t2 && je(e2.compression, dn(e2.url, "compression")) && !((r2 = t2.body) instanceof ArrayBuffer ? ze(new Uint8Array(r2)) : ArrayBuffer.isView(r2) && ze(new Uint8Array(r2.buffer, r2.byteOffset, r2.byteLength))) ? (Oo = true, s2()) : { url: e2.url, encodedBody: t2 };
  };
  var Uo = (e2) => {
    try {
      return qo(e2);
    } catch (t2) {
      return Tr.error(t2), void (null == e2.callback || e2.callback({ statusCode: 0, error: t2 }));
    }
  };
  var Ho = function() {
    var e2 = t(function* (e3) {
      var t2 = un(e3.data), r2 = yield function(e4, t3, i2) {
        return Ke.apply(this, arguments);
      }(t2, n.DEBUG, { rethrow: true });
      if (!r2) return e3;
      var s2 = yield r2.arrayBuffer();
      return i({}, e3, { _encodedBody: { contentType: $o, body: s2, estimatedSize: s2.byteLength } });
    });
    return function(t2) {
      return e2.apply(this, arguments);
    };
  }();
  var zo = /Failed to fetch|NetworkError|Load failed/i;
  var jo = (e2) => {
    var t2 = Uo(e2);
    if (t2) {
      var r2 = t2.url, s2 = t2.encodedBody, n2 = null != s2 ? s2 : {}, o2 = n2.contentType, a2 = n2.body, l2 = n2.estimatedSize, u2 = new Headers();
      Lr(e2.headers, function(e3, t3) {
        u2.append(t3, e3);
      }), o2 && u2.append("Content-Type", o2);
      var c2 = null, d2 = false;
      if (Ie) {
        var _2 = new Ie();
        c2 = { signal: _2.signal, timeout: setTimeout(() => {
          var t3, i2;
          d2 = true, _2.abort((t3 = e2.timeout, (i2 = new Error("PostHog request timed out" + (t3 ? " after " + t3 + "ms" : ""))).name = "AbortError", i2));
        }, e2.timeout) };
      }
      var h2 = (t3) => {
        d2 && "AbortError" === (null == t3 ? void 0 : t3.name) || ((e3) => "TypeError" === (null == e3 ? void 0 : e3.name) && zo.test((null == e3 ? void 0 : e3.message) || ""))(t3) ? Tr.warn(t3) : Tr.error(t3), null == e2.callback || e2.callback({ statusCode: 0, error: t3 });
      };
      try {
        var p2;
        ke(r2, i({ method: (null == e2 ? void 0 : e2.method) || "GET", headers: u2, keepalive: "POST" === e2.method && !e2._keepaliveDisabled && 52428.8 > (l2 || 0), body: a2, signal: null == (p2 = c2) ? void 0 : p2.signal }, e2.fetchOptions)).then((t3) => t3.text().then((i2) => {
          var r3 = { statusCode: t3.status, text: i2 };
          if (200 === t3.status) try {
            r3.json = JSON.parse(i2);
          } catch (e3) {
            Tr.error(e3);
          }
          null == e2.callback || e2.callback(r3);
        })).catch(h2).finally(() => c2 ? clearTimeout(c2.timeout) : null);
      } catch (e3) {
        c2 && clearTimeout(c2.timeout), h2(e3);
      }
    }
  };
  var Vo = (e2) => {
    try {
      var t2 = qo(e2), r2 = t2.url, s2 = t2.encodedBody, n2 = null != s2 ? s2 : {}, o2 = n2.body, a2 = n2.estimatedSize;
      if (!o2) return;
      var l2 = o2 instanceof Blob ? o2 : new Blob([o2], { type: n2.contentType });
      if (Se.sendBeacon(r2, l2)) return;
      if (st(e2.data) && e2.data.length > 1 && (null != a2 ? a2 : 0) > 16384) {
        var u2 = Math.ceil(e2.data.length / 2);
        return Vo(i({}, e2, { data: e2.data.slice(0, u2) })), void Vo(i({}, e2, { data: e2.data.slice(u2) }));
      }
      Tr.warn("Beacon of ~" + (null != a2 ? a2 : 0) + " bytes was rejected by the browser, falling back to fetch"), jo(i({}, e2, { _keepaliveDisabled: true }));
    } catch (e3) {
      Tr.warn("Beacon send failed", e3);
    }
  };
  var Wo = ["/e/", "/s/"];
  var Go = (e2, t2, r2, s2) => {
    var o2 = ((e3) => {
      var t3 = ((e4) => {
        var t4 = cn(e4), i2 = (null == t4 ? void 0 : t4.pathname) || e4.split(/[?#]/)[0];
        return i2 ? "/" === i2[0] ? i2 : "/" + i2 : "/";
      })(e3);
      return Wo.some((e4) => ((e5, t4) => e5.slice(e5.length - t4.length) === t4)(t3, e4));
    })(e2), a2 = o2 ? Do(e2, "ver") : e2, l2 = "query" === s2 ? "POST" === t2 ? "sent_at" : "_" : void 0;
    return No(r2 === eo.GZipJS ? Do(a2, "compression") : a2, i({}, l2 ? { [l2]: Date.now().toString() } : {}, o2 ? {} : { ver: n.JS_SDK_VERSION }, r2 === eo.GZipJS ? {} : { compression: r2 }));
  };
  var Ko = [];
  ke && Ko.push({ transport: "fetch", method: jo }), Pe && Ko.push({ transport: "XHR", method(e2) {
    var t2 = Uo(e2);
    if (t2) {
      var i2 = new Pe(), r2 = t2.encodedBody;
      i2.open(e2.method || "GET", t2.url, true);
      var s2 = null != r2 ? r2 : {}, n2 = s2.contentType, o2 = s2.body;
      Lr(e2.headers, function(e3, t3) {
        i2.setRequestHeader(t3, e3);
      }), n2 && i2.setRequestHeader("Content-Type", n2), e2.timeout && (i2.timeout = e2.timeout), i2.onreadystatechange = () => {
        if (4 === i2.readyState) {
          var t3 = { statusCode: i2.status, text: i2.responseText };
          if (200 === i2.status) try {
            t3.json = JSON.parse(i2.responseText);
          } catch (e3) {
          }
          null == e2.callback || e2.callback(t3);
        }
      }, i2.send(o2);
    }
  } }), null != Se && Se.sendBeacon && Ko.push({ transport: "sendBeacon", method: Vo });
  var Qo = 3e3;
  var Yo = class {
    constructor(e2, t2) {
      this._isPaused = true, this._queue = [], this._flushTimeoutMs = kt((null == t2 ? void 0 : t2.flush_interval_ms) || Qo, 250, 5e3, Tr.createLogger("flush interval"), Qo), this._sendRequest = e2;
    }
    enqueue(e2) {
      this._queue.push(e2), this._flushTimeout || this._setFlushTimeout();
    }
    unload() {
      this._clearFlushTimeout();
      var e2 = this._queue.length > 0 ? this._formatQueue() : {}, t2 = Object.values(e2);
      [...t2.filter((e3) => 0 === e3.url.indexOf("/e")), ...t2.filter((e3) => 0 !== e3.url.indexOf("/e"))].map((e3) => {
        this._sendRequestSafely(i({}, e3, { transport: "sendBeacon" }));
      });
    }
    enable() {
      this._isPaused = false, this._setFlushTimeout();
    }
    _setFlushTimeout() {
      var e2 = this;
      this._isPaused || (this._flushTimeout = setTimeout(() => {
        if (this._clearFlushTimeout(), this._queue.length > 0) {
          var t2 = this._formatQueue(), i2 = function() {
            var i3 = t2[r2], s2 = (/* @__PURE__ */ new Date()).getTime();
            i3.data && st(i3.data) && Lr(i3.data, (e3) => {
              e3.offset = Math.abs(e3.timestamp - s2), delete e3.timestamp;
            }), e2._sendRequestSafely(i3);
          };
          for (var r2 in t2) i2();
        }
      }, this._flushTimeoutMs));
    }
    _sendRequestSafely(e2) {
      try {
        this._sendRequest(e2);
      } catch (e3) {
        Tr.error(e3);
      }
    }
    _clearFlushTimeout() {
      clearTimeout(this._flushTimeout), this._flushTimeout = void 0;
    }
    _formatQueue() {
      var e2 = {};
      return Lr(this._queue, (t2) => {
        var r2, s2 = t2, n2 = (s2 ? s2.batchKey : null) || s2.url;
        lt(e2[n2]) && (e2[n2] = i({}, s2, { data: [] })), null == (r2 = e2[n2].data) || r2.push(s2.data);
      }), this._queue = [], e2;
    }
  };
  var Jo = ["retriesPerformedSoFar"];
  var Zo = class {
    constructor(e2) {
      this._isPolling = false, this._pollIntervalMs = 3e3, this._queue = [], this._instance = e2, this._queue = [], this._areWeOnline = true, !lt(be) && "onLine" in be.navigator && (this._areWeOnline = be.navigator.onLine, this._onlineListener = () => {
        this._areWeOnline = true, this._flush();
      }, this._offlineListener = () => {
        this._areWeOnline = false;
      }, qr(be, "online", this._onlineListener), qr(be, "offline", this._offlineListener));
    }
    get length() {
      return this._queue.length;
    }
    retriableRequest(e2) {
      var t2 = e2.retriesPerformedSoFar, s2 = r(e2, Jo);
      pt(t2) && (s2.url = No(s2.url, { retry_count: t2 })), this._instance._send_request(i({}, s2, { callback: (e3) => {
        if (200 !== e3.statusCode && (400 > e3.statusCode || e3.statusCode >= 500)) {
          if ((0 === e3.statusCode ? 3 : 10) > (null != t2 ? t2 : 0)) return void this._enqueue(i({ retriesPerformedSoFar: t2 }, s2));
          0 === e3.statusCode && Tr.warn("Request failed before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped retrying after " + (null != t2 ? t2 : 0) + " retries.");
        }
        null == s2.callback || s2.callback(e3);
      } }));
    }
    _enqueue(e2) {
      var t2 = e2.retriesPerformedSoFar || 0;
      e2.retriesPerformedSoFar = t2 + 1;
      var i2 = function(e3) {
        var t3 = 3e3 * Math.pow(2, e3), i3 = t3 / 2, r3 = Math.min(18e5, t3), s3 = Math.random() - 0.5;
        return Math.ceil(r3 + s3 * (r3 - i3));
      }(t2), r2 = Date.now() + i2;
      this._queue.push({ retryAt: r2, requestOptions: e2 });
      var s2 = "Enqueued failed request for retry in " + i2;
      navigator.onLine || (s2 += " (Browser is offline)"), Tr.warn(s2), this._isPolling || (this._isPolling = true, this._poll());
    }
    _poll() {
      if (this._poller && clearTimeout(this._poller), 0 === this._queue.length) return this._isPolling = false, void (this._poller = void 0);
      this._poller = setTimeout(() => {
        this._areWeOnline && this._queue.length > 0 && this._flush(), this._poll();
      }, this._pollIntervalMs);
    }
    _flush() {
      var e2 = Date.now(), t2 = [], i2 = this._queue.filter((i3) => e2 > i3.retryAt || (t2.push(i3), false));
      if (this._queue = t2, i2.length > 0) for (var r2 of i2) this.retriableRequest(r2.requestOptions);
    }
    unload() {
      for (var e2 of (this._poller && (clearTimeout(this._poller), this._poller = void 0), this._isPolling = false, lt(be) || (this._onlineListener && (be.removeEventListener("online", this._onlineListener), this._onlineListener = void 0), this._offlineListener && (be.removeEventListener("offline", this._offlineListener), this._offlineListener = void 0)), this._queue)) {
        var t2 = e2.requestOptions;
        try {
          this._instance._send_request(i({}, t2, { transport: "sendBeacon" }));
        } catch (e3) {
          Tr.error(e3);
        }
      }
      this._queue = [];
    }
  };
  var Xo = class {
    constructor(e2) {
      this._updateScrollData = () => {
        var e3, t2, i2, r2;
        this._context || (this._context = {});
        var s2 = this.scrollElement(), n2 = this.scrollY(), o2 = s2 ? Math.max(0, s2.scrollHeight - s2.clientHeight) : 0, a2 = n2 + ((null == s2 ? void 0 : s2.clientHeight) || 0), l2 = (null == s2 ? void 0 : s2.scrollHeight) || 0;
        this._context.lastScrollY = Math.ceil(n2), this._context.maxScrollY = Math.max(n2, null !== (e3 = this._context.maxScrollY) && void 0 !== e3 ? e3 : 0), this._context.maxScrollHeight = Math.max(o2, null !== (t2 = this._context.maxScrollHeight) && void 0 !== t2 ? t2 : 0), this._context.lastContentY = a2, this._context.maxContentY = Math.max(a2, null !== (i2 = this._context.maxContentY) && void 0 !== i2 ? i2 : 0), this._context.maxContentHeight = Math.max(l2, null !== (r2 = this._context.maxContentHeight) && void 0 !== r2 ? r2 : 0);
      }, this._instance = e2;
    }
    get _scrollRoot() {
      return this._instance.config.scroll_root_selector;
    }
    getContext() {
      return this._context;
    }
    resetContext() {
      var e2 = this._context;
      return setTimeout(this._updateScrollData, 0), e2;
    }
    startMeasuringScrollPosition() {
      qr(be, "scroll", this._updateScrollData, { capture: true }), qr(be, "scrollend", this._updateScrollData, { capture: true }), qr(be, "resize", this._updateScrollData);
    }
    scrollElement() {
      if (!this._scrollRoot) return null == be ? void 0 : be.document.documentElement;
      var e2 = st(this._scrollRoot) ? this._scrollRoot : [this._scrollRoot];
      for (var t2 of e2) {
        var i2 = null == be ? void 0 : be.document.querySelector(t2);
        if (i2) return i2;
      }
    }
    _scrollPosition(e2) {
      var t2 = "y" === e2 ? "scrollTop" : "scrollLeft";
      if (this._scrollRoot) {
        var i2 = this.scrollElement();
        return i2 && i2[t2] || 0;
      }
      return be ? "y" === e2 ? be.scrollY || be.pageYOffset || be.document.documentElement.scrollTop || 0 : be.scrollX || be.pageXOffset || be.document.documentElement.scrollLeft || 0 : 0;
    }
    scrollY() {
      return this._scrollPosition("y");
    }
    scrollX() {
      return this._scrollPosition("x");
    }
  };
  var ea = (e2) => In(null == e2 ? void 0 : e2.config.mask_personal_data_properties, null == e2 ? void 0 : e2.config.custom_personal_data_properties, null == e2 ? void 0 : e2.config.disable_capture_url_hashes);
  var ta = class {
    constructor(e2, t2, i2, r2) {
      this._onSessionIdCallback = (e3) => {
        var t3 = this._getStored();
        if (!t3 || t3.sessionId !== e3) {
          var i3 = { sessionId: e3, props: this._sessionSourceParamGenerator(this._instance) };
          this._persistence.register({ [J]: i3 });
        }
      }, this._instance = e2, this._sessionIdManager = t2, this._persistence = i2, this._sessionSourceParamGenerator = r2 || ea, this._sessionIdManager.onSessionId(this._onSessionIdCallback);
    }
    _getStored() {
      return this._persistence.props[J];
    }
    getSetOnceProps() {
      var e2, t2 = null == (e2 = this._getStored()) ? void 0 : e2.props;
      return t2 ? "r" in t2 ? Cn(t2, this._instance.config.disable_capture_url_hashes) : { $referring_domain: t2.referringDomain, $pathname: t2.initialPathName, utm_source: t2.utm_source, utm_campaign: t2.utm_campaign, utm_medium: t2.utm_medium, utm_content: t2.utm_content, utm_term: t2.utm_term } : {};
    }
    getSessionProps() {
      var e2 = {};
      return Lr(Dr(this.getSetOnceProps()), (t2, i2) => {
        "$current_url" === i2 && (i2 = "url"), e2["$session_entry_" + Xe(i2)] = t2;
      }), e2;
    }
  };
  var ia = class {
    on(e2, t2) {
      return this._events[e2] || (this._events[e2] = []), this._events[e2].push(t2), () => {
        this._events[e2] = this._events[e2].filter((e3) => e3 !== t2);
      };
    }
    emit(e2, t2) {
      for (var i2 of this._events[e2] || []) i2(t2);
      for (var r2 of this._events["*"] || []) r2(e2, t2);
    }
    constructor() {
      this._events = {};
    }
  };
  var ra = Fr("[SessionId]");
  var sa = class {
    on(e2, t2) {
      return this._eventEmitter.on(e2, t2);
    }
    constructor(e2, t2, i2) {
      var r2;
      if (this._lastPersistedActivityTimestamp = null, this._sessionIdChangedHandlers = [], this._beforeUnloadListener = void 0, this._destroyed = false, this._eventEmitter = new ia(), this._sessionHasBeenIdleTooLong = (e3, t3) => !(!pt(e3) || !pt(t3)) && Math.abs(e3 - t3) > this.sessionTimeoutMs, !e2.persistence) throw new Error("SessionIdManager requires a PostHogPersistence instance");
      if (e2.config.cookieless_mode === ce) throw new Error('SessionIdManager cannot be used with cookieless_mode="always"');
      this._config = e2.config, this._persistence = e2.persistence, this._windowId = void 0, this._sessionId = void 0, this._sessionStartTimestamp = null, this._sessionActivityTimestamp = null, this._sessionIdGenerator = t2 || Kr, this._windowIdGenerator = i2 || Kr;
      var s2 = this._config.persistence_name || this._config.token;
      if (this._sessionTimeoutMs = 1e3 * kt(this._config.session_idle_timeout_seconds || 1800, 60, 36e3, ra.createLogger("session_idle_timeout_seconds"), 1800), e2.register({ $configured_session_timeout_ms: this._sessionTimeoutMs }), this._resetIdleTimer(), this._window_id_storage_key = "ph_" + s2 + "_window_id", this._primary_window_exists_storage_key = "ph_" + s2 + "_primary_window_exists", this._canUseSessionStorage()) {
        var n2 = ns._parse(this._window_id_storage_key), o2 = ns._parse(this._primary_window_exists_storage_key);
        n2 && !o2 ? this._windowId = n2 : ns._remove(this._window_id_storage_key), ns._set(this._primary_window_exists_storage_key, true);
      }
      if (null != (r2 = this._config.bootstrap) && r2.sessionID) try {
        var a2 = ((e3) => {
          var t3 = this._config.bootstrap.sessionID.replace(/-/g, "");
          if (32 !== t3.length) throw new Error("Not a valid UUID");
          if ("7" !== t3[12]) throw new Error("Not a UUIDv7");
          return parseInt(t3.substring(0, 12), 16);
        })();
        this._setSessionId(this._config.bootstrap.sessionID, (/* @__PURE__ */ new Date()).getTime(), a2);
      } catch (e3) {
        ra.error("Invalid sessionID in bootstrap", e3);
      }
      this._listenToReloadWindow();
    }
    get sessionTimeoutMs() {
      return this._sessionTimeoutMs;
    }
    onSessionId(e2) {
      return lt(this._sessionIdChangedHandlers) && (this._sessionIdChangedHandlers = []), this._sessionIdChangedHandlers.push(e2), this._sessionId && e2(this._sessionId, this._windowId), () => {
        this._sessionIdChangedHandlers = this._sessionIdChangedHandlers.filter((t2) => t2 !== e2);
      };
    }
    _canUseSessionStorage() {
      return "memory" !== this._config.persistence && !this._persistence._disabled && ns._is_supported();
    }
    _setWindowId(e2) {
      e2 !== this._windowId && (this._windowId = e2, this._canUseSessionStorage() && ns._set(this._window_id_storage_key, e2));
    }
    _getWindowId() {
      return this._windowId ? this._windowId : this._canUseSessionStorage() ? ns._parse(this._window_id_storage_key) : null;
    }
    _isActivityChangeBelowGranularity(e2) {
      var t2 = this._lastPersistedActivityTimestamp;
      return !dt(t2) && !dt(e2) && 5e3 > Math.abs(e2 - t2);
    }
    _setSessionId(e2, t2, i2) {
      var r2 = t2 !== this._sessionActivityTimestamp, s2 = !(e2 !== this._sessionId || i2 !== this._sessionStartTimestamp);
      this._sessionStartTimestamp = i2, this._sessionActivityTimestamp = t2, this._sessionId = e2, s2 && !r2 || s2 && this._isActivityChangeBelowGranularity(t2) || (this._lastPersistedActivityTimestamp = t2, this._persistence.register({ [I]: [t2, e2, i2] }));
    }
    _useCrossTabRefreshHardening() {
      var e2, t2 = null == (e2 = this._config) ? void 0 : e2.persistence_save_debounce_ms;
      return pt(t2) && t2 > 0;
    }
    _refreshSessionIdFromStorage() {
      this._useCrossTabRefreshHardening() ? this._persistence.refreshKey(I) : (this._persistence.flush(), this._persistence.load());
    }
    _flushPendingActivityTimestamp() {
      var e2;
      if (!dt(this._sessionActivityTimestamp) && this._sessionActivityTimestamp !== this._lastPersistedActivityTimestamp) {
        this._refreshSessionIdFromStorage();
        var t2 = this._getSessionId();
        t2[1] === this._sessionId && t2[2] === this._sessionStartTimestamp && (this._lastPersistedActivityTimestamp = this._sessionActivityTimestamp, this._persistence.register({ [I]: [this._sessionActivityTimestamp, null !== (e2 = this._sessionId) && void 0 !== e2 ? e2 : null, this._sessionStartTimestamp] }), this._persistence.flush());
      }
    }
    _freshestActivityTimestamp() {
      var e2 = this._getSessionId()[0], t2 = pt(e2) ? e2 : 0, i2 = pt(this._sessionActivityTimestamp) ? this._sessionActivityTimestamp : 0;
      return Math.max(t2, i2);
    }
    _isSessionIdleAfterCrossTabRefresh(e2) {
      return this._refreshSessionIdFromStorage(), this._sessionHasBeenIdleTooLong(e2, this._freshestActivityTimestamp());
    }
    _getSessionId() {
      var e2 = this._persistence.props[I];
      return st(e2) && 2 === e2.length && e2.push(e2[0]), e2 || [0, null, 0];
    }
    resetSessionId() {
      this._lastPersistedActivityTimestamp = null, clearTimeout(this._enforceIdleTimeout), this._enforceIdleTimeout = void 0, this._setSessionId(null, null, null);
    }
    destroy() {
      this._destroyed = true, this._flushPendingActivityTimestamp(), clearTimeout(this._enforceIdleTimeout), this._enforceIdleTimeout = void 0, this._beforeUnloadListener && be && (be.removeEventListener(ge, this._beforeUnloadListener, { capture: false }), this._beforeUnloadListener = void 0), this._sessionIdChangedHandlers = [];
    }
    _listenToReloadWindow() {
      this._beforeUnloadListener = () => {
        this._flushPendingActivityTimestamp(), this._canUseSessionStorage() && ns._remove(this._primary_window_exists_storage_key);
      }, qr(be, ge, this._beforeUnloadListener, { capture: false });
    }
    checkAndGetSessionAndWindowId(e2, t2) {
      if (void 0 === e2 && (e2 = false), void 0 === t2 && (t2 = null), this._config.cookieless_mode === ce) throw new Error('checkAndGetSessionAndWindowId should not be called with cookieless_mode="always"');
      var i2 = t2 || (/* @__PURE__ */ new Date()).getTime(), r2 = this._getSessionId(), s2 = r2[1], n2 = r2[2], o2 = this._freshestActivityTimestamp(), a2 = this._getWindowId(), l2 = pt(n2) && Math.abs(i2 - n2) > 864e5, u2 = false, c2 = false, d2 = !s2, _2 = s2, h2 = !d2 && !e2 && this._sessionHasBeenIdleTooLong(i2, o2);
      if (h2) {
        (h2 = this._isSessionIdleAfterCrossTabRefresh(i2)) || ra.info("cross-tab refresh kept the session alive", { sessionId: s2 });
        var p2 = this._getSessionId();
        s2 = p2[1], n2 = p2[2];
      }
      d2 || h2 || l2 ? (s2 = this._sessionIdGenerator(), a2 = this._windowIdGenerator(), ra.info("new session ID generated", { sessionId: s2, windowId: a2, changeReason: { noSessionId: d2, activityTimeout: h2, sessionPastMaximumLength: l2 } }), n2 = i2, u2 = true) : (a2 || (a2 = this._windowIdGenerator(), u2 = true), (c2 = s2 !== _2) && (ra.info("adopted cross-tab session id", { sessionId: s2, windowId: a2 }), u2 = true));
      var g2 = pt(o2) && e2 && !l2 ? o2 : i2, v2 = pt(n2) ? n2 : (/* @__PURE__ */ new Date()).getTime();
      this._setWindowId(a2), this._setSessionId(s2, g2, v2), e2 || this._resetIdleTimer();
      var f2 = { noSessionId: d2, activityTimeout: h2, sessionPastMaximumLength: l2, crossTabAdoption: c2 };
      return u2 && this._sessionIdChangedHandlers.forEach((e3) => e3(s2, a2, f2)), { sessionId: s2, windowId: a2, sessionStartTimestamp: v2, changeReason: u2 ? f2 : void 0, lastActivityTimestamp: o2 };
    }
    _resetIdleTimer() {
      this._destroyed || (clearTimeout(this._enforceIdleTimeout), this._enforceIdleTimeout = setTimeout(() => {
        if (!this._destroyed) if (this._isSessionIdleAfterCrossTabRefresh((/* @__PURE__ */ new Date()).getTime())) {
          var e2 = this._sessionId;
          this.resetSessionId(), this._eventEmitter.emit("forcedIdleReset", { idleSessionId: e2 });
        } else this._resetIdleTimer();
      }, 1.1 * this.sessionTimeoutMs));
    }
  };
  var na = function(e2, t2) {
    if (!e2) return false;
    var i2 = e2.userAgent;
    if (i2 && Ye(i2, t2)) return true;
    try {
      var r2 = null == e2 ? void 0 : e2.userAgentData;
      if (null != r2 && r2.brands && r2.brands.some((e3) => Ye(null == e3 ? void 0 : e3.brand, t2))) return true;
    } catch (e3) {
    }
    return !!e2.webdriver;
  };
  function oa() {
    return (oa = t(function* () {
      var e2 = null == Se ? void 0 : Se.userAgentData;
      if (null != e2 && e2.getHighEntropyValues) try {
        var t2 = yield e2.getHighEntropyValues(["model"]), i2 = null == t2 ? void 0 : t2.model;
        return ut(i2) && i2.length > 0 ? i2 : void 0;
      } catch (e3) {
        return void Tr.info("Unable to resolve $device_model from userAgentData.getHighEntropyValues", e3);
      }
    })).apply(this, arguments);
  }
  var aa = function(e2, t2) {
    if (!function(e3) {
      try {
        new RegExp(e3);
      } catch (e4) {
        return false;
      }
      return true;
    }(t2)) return false;
    try {
      return new RegExp(t2).test(e2);
    } catch (e3) {
      return false;
    }
  };
  function la(e2, t2, i2) {
    return un({ distinct_id: e2, userPropertiesToSet: t2, userPropertiesToSetOnce: i2 });
  }
  var ua = { exact: (e2, t2) => t2.some((t3) => e2.some((e3) => t3 === e3)), is_not: (e2, t2) => t2.every((t3) => e2.every((e3) => t3 !== e3)), regex: (e2, t2) => t2.some((t3) => e2.some((e3) => aa(t3, e3))), not_regex: (e2, t2) => t2.every((t3) => e2.every((e3) => !aa(t3, e3))), icontains: (e2, t2) => t2.map(ca).some((t3) => e2.map(ca).some((e3) => t3.includes(e3))), not_icontains: (e2, t2) => t2.map(ca).every((t3) => e2.map(ca).every((e3) => !t3.includes(e3))), gt: (e2, t2) => t2.some((t3) => {
    var i2 = parseFloat(t3);
    return !isNaN(i2) && e2.some((e3) => i2 > parseFloat(e3));
  }), lt: (e2, t2) => t2.some((t3) => {
    var i2 = parseFloat(t3);
    return !isNaN(i2) && e2.some((e3) => i2 < parseFloat(e3));
  }) };
  var ca = (e2) => e2.toLowerCase();
  function da(e2, t2) {
    return !e2 || Object.entries(e2).every((e3) => {
      var i2 = e3[1], r2 = null == t2 ? void 0 : t2[e3[0]];
      if (lt(r2) || dt(r2)) return false;
      var s2 = [String(r2)], n2 = ua[i2.operator];
      return !!n2 && n2(i2.values, s2);
    });
  }
  var _a = "custom";
  var ha = "i.posthog.com";
  var pa = /^\/static\//;
  var ga = class {
    constructor(e2) {
      this._regionCache = {}, this.instance = e2;
    }
    get apiHost() {
      var e2 = this.instance.config.api_host.trim().replace(/\/$/, "");
      return "https://app.posthog.com" === e2 ? "https://us.i.posthog.com" : e2;
    }
    get flagsApiHost() {
      var e2 = this.instance.config.flags_api_host;
      return e2 ? e2.trim().replace(/\/$/, "") : this.apiHost;
    }
    get uiHost() {
      var e2, t2 = null == (e2 = this.instance.config.ui_host) ? void 0 : e2.replace(/\/$/, "");
      return t2 || (t2 = this.apiHost.replace("." + ha, ".posthog.com")), "https://app.posthog.com" === t2 ? "https://us.posthog.com" : t2;
    }
    get region() {
      return this._regionCache[this.apiHost] || (this._regionCache[this.apiHost] = /https:\/\/(app|us|us-assets)(\.i)?\.posthog\.com/i.test(this.apiHost) ? "us" : /https:\/\/(eu|eu-assets)(\.i)?\.posthog\.com/i.test(this.apiHost) ? "eu" : _a), this._regionCache[this.apiHost];
    }
    _staticAssetHostOverride(e2) {
      if (pa.test(e2)) {
        var t2 = this.instance.config.asset_host;
        if ("string" == typeof t2) return t2.trim().replace(/\/$/, "") || void 0;
      }
    }
    endpointFor(e2, t2) {
      if (void 0 === t2 && (t2 = ""), t2 && (t2 = "/" === t2[0] ? t2 : "/" + t2), "ui" === e2) return this.uiHost + t2;
      if ("flags" === e2) return this.flagsApiHost + t2;
      if ("assets" === e2) {
        var i2 = this._staticAssetHostOverride(t2);
        if (i2) return "" + i2 + t2;
      }
      if (this.region === _a) return this.apiHost + t2;
      var r2 = ha + t2;
      switch (e2) {
        case "assets":
          return "https://" + this.region + "-assets." + r2;
        case "api":
          return "https://" + this.region + "." + r2;
      }
    }
  };
  function va(e2) {
    var t2;
    return !(null == (t2 = e2.conditions) || null == (t2 = t2.events) || null == (t2 = t2.values) || !t2.length);
  }
  var fa = Fr("[Surveys]");
  var ma = "seenSurvey_";
  var ya = (e2) => {
    try {
      var t2 = ((e3) => ((e4, t3) => "" + ma + function(e5) {
        return e5.current_iteration && e5.current_iteration > 0 ? e5.id + "_" + e5.current_iteration : e5.id;
      }(t3))(0, e3))(e2);
      if (localStorage.getItem(t2)) return;
      localStorage.setItem(t2, "true");
    } catch (e3) {
      fa.error("Failed to persist survey seen state", e3);
    }
  };
  var ba = [Bn.Popover, Bn.Widget, Bn.API];
  var wa = { ignoreConditions: false, ignoreDelay: false, displayType: Vn.Popover };
  var Sa = Fr("[PostHog ExternalIntegrations]");
  var Ea = { intercom: "intercom-integration", crispChat: "crisp-chat-integration" };
  var xa = class {
    constructor(e2) {
      this._instance = e2;
    }
    _loadScript(e2, t2) {
      var i2;
      null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, e2, (e3) => {
        if (e3) return Sa.error("failed to load script", e3);
        t2();
      });
    }
    startIfEnabledOrStop() {
      var e2 = this, t2 = function() {
        var t3, r3, s2, n2 = i2[0], o2 = i2[1];
        !o2 || null != (t3 = Le.__PosthogExtensions__) && null != (t3 = t3.integrations) && t3[n2] || e2._loadScript(Ea[n2], () => {
          var t4;
          null == (t4 = Le.__PosthogExtensions__) || null == (t4 = t4.integrations) || null == (t4 = t4[n2]) || t4.start(e2._instance);
        }), !o2 && null != (r3 = Le.__PosthogExtensions__) && null != (r3 = r3.integrations) && r3[n2] && (null == (s2 = Le.__PosthogExtensions__) || null == (s2 = s2.integrations) || null == (s2 = s2[n2]) || s2.stop());
      };
      for (var i2 of Object.entries(null !== (r2 = this._instance.config.integrations) && void 0 !== r2 ? r2 : {})) {
        var r2;
        t2();
      }
    }
  };
  var ka = {};
  var Pa = 0;
  var Ia = () => {
  };
  var Ca = 'Consent opt in/out is not valid with cookieless_mode="always" and will be ignored';
  var Ta = "Surveys module not available";
  var Fa = "sanitize_properties is deprecated. Use before_send instead";
  var Ra = "Invalid value for property_denylist config: ";
  var La = ["token", "distinct_id", se];
  var Ma = "posthog";
  var Aa = !Ao && -1 === (null == Te ? void 0 : Te.indexOf("MSIE")) && -1 === (null == Te ? void 0 : Te.indexOf("Mozilla"));
  var $a = (e2) => {
    var t2;
    return i({ api_host: "https://us.i.posthog.com", flags_api_host: null, ui_host: null, asset_host: null, token: "", autocapture: true, cross_subdomain_cookie: Br(null == Ee ? void 0 : Ee.location), persistence: "localStorage+cookie", persistence_name: "", cookie_persisted_properties: [], loaded: Ia, save_campaign_params: true, custom_campaign_params: [], custom_blocked_useragents: [], save_referrer: true, capture_pageleave: "if_capture_pageview", defaults: null != e2 ? e2 : "unset", __preview_deferred_init_extensions: false, __preview_external_dependency_versioned_paths: false, __preview_cookie_wins_on_conflict: false, debug: xe && ut(null == xe ? void 0 : xe.search) && -1 !== xe.search.indexOf("__posthog_debug=true") || false, cookie_expiration: 365, upgrade: false, disable_session_recording: false, disable_persistence: false, disable_web_experiments: true, disable_surveys: false, disable_surveys_automatic_display: false, disable_conversations: false, disable_product_tours: false, disableDeviceModel: false, disable_external_dependency_loading: false, strict_script_versioning: false, enable_recording_console_log: void 0, secure_cookie: "https:" === (null == be || null == (t2 = be.location) ? void 0 : t2.protocol), ip: false, opt_out_capturing_by_default: false, opt_out_persistence_by_default: false, opt_out_useragent_filter: false, opt_out_capturing_persistence_type: "localStorage", consent_persistence_name: null, opt_out_capturing_cookie_prefix: null, opt_in_site_apps: false, property_denylist: [], respect_dnt: false, sanitize_properties: null, request_headers: {}, request_batching: true, properties_string_max_length: 65535, mask_all_element_attributes: false, mask_all_text: false, mask_personal_data_properties: false, custom_personal_data_properties: [], advanced_disable_flags: false, advanced_disable_decide: false, advanced_disable_feature_flags: false, advanced_disable_feature_flags_on_first_load: false, advanced_only_evaluate_survey_feature_flags: false, advanced_feature_flags_dedup_per_session: false, advanced_enable_surveys: false, advanced_disable_toolbar_metrics: false, feature_flag_request_timeout_ms: 3e3, surveys_request_timeout_ms: 1e4, on_request_error(e3) {
      Tr.error("Bad HTTP status: " + e3.statusCode + " " + e3.text);
    }, get_device_id: (e3) => e3, capture_performance: void 0, name: "posthog", bootstrap: {}, disable_compression: false, session_idle_timeout_seconds: 1800, person_profiles: he, before_send: void 0, get_current_url: void 0, request_queue_config: { flush_interval_ms: Qo }, error_tracking: {}, _onCapture: Ia }, ((e3) => ({ rageclick: e3 && e3 >= "2026-05-30" ? { content_ignorelist: Ts, ignore_text_selection: true } : !e3 || "2025-11-30" > e3 || { content_ignorelist: true }, capture_pageview: !e3 || "2025-05-24" > e3 || "history_change", session_recording: e3 && e3 >= "2026-06-25" ? { strictMinimumDuration: true, canvasCapture: { resolutionScale: 0.6 }, streamNetworkBody: true } : e3 && e3 >= "2026-05-30" ? { strictMinimumDuration: true, canvasCapture: { resolutionScale: 0.6 } } : e3 && e3 >= "2025-11-30" ? { strictMinimumDuration: true } : {}, external_scripts_inject_target: e3 && e3 >= "2026-01-30" ? "head" : "body", internal_or_test_user_hostname: e3 && e3 >= "2026-01-30" ? /^(localhost|127\.0\.0\.1)$/ : void 0, persistence_save_debounce_ms: e3 && e3 >= "2026-05-30" ? 250 : 0, split_storage: !(!e3 || "2026-05-30" > e3), detect_google_search_app: !(!e3 || "2026-05-30" > e3), disable_capture_url_hashes: !(!e3 || "2026-06-25" > e3) }))(e2));
  };
  var Oa = [["process_person", "person_profiles"], ["xhr_headers", "request_headers"], ["cookie_name", "persistence_name"], ["disable_cookie", "disable_persistence"], ["__preview_disable_beacon", "disable_beacon"], ["store_google", "save_campaign_params"], ["verbose", "debug"]];
  var Da = (e2) => {
    var t2 = {};
    for (var i2 of Oa) {
      var r2 = i2[0], s2 = i2[1];
      lt(e2[r2]) || (t2[s2] = e2[r2]);
    }
    var n2 = Mr({}, t2, e2), o2 = e2.__preview_external_dependency_versioned_paths;
    return lt(o2) || (lt(e2.strict_script_versioning) && (n2.strict_script_versioning = !!o2), ut(o2) && lt(e2.asset_host) && (n2.asset_host = o2)), st(e2.property_blacklist) && (lt(e2.property_denylist) ? n2.property_denylist = e2.property_blacklist : st(e2.property_denylist) ? n2.property_denylist = [...e2.property_blacklist, ...e2.property_denylist] : Tr.error(Ra + e2.property_denylist)), n2;
  };
  var Na = class {
    constructor() {
      this.__forceAllowLocalhost = false;
    }
    get _forceAllowLocalhost() {
      return this.__forceAllowLocalhost;
    }
    set _forceAllowLocalhost(e2) {
      Tr.error("WebPerformanceObserver is deprecated and has no impact on network capture. Use `_forceAllowLocalhostNetworkCapture` on `posthog.sessionRecording`"), this.__forceAllowLocalhost = e2;
    }
  };
  var Ba = class _Ba {
    _replaceExtension(e2, t2) {
      if (e2) {
        var i2 = this._extensions.indexOf(e2);
        -1 !== i2 && this._extensions.splice(i2, 1);
      }
      return this._extensions.push(t2), null == t2.initialize || t2.initialize(), t2;
    }
    _inCookielessMode() {
      return this.config.cookieless_mode === ce || this.config.cookieless_mode === ue && this.consent.isRejected();
    }
    get decideEndpointWasHit() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this.featureFlags) ? void 0 : t2.hasLoadedFlags) && void 0 !== e2 && e2;
    }
    get flagsEndpointWasHit() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this.featureFlags) ? void 0 : t2.hasLoadedFlags) && void 0 !== e2 && e2;
    }
    constructor() {
      var e2;
      this.webPerformance = new Na(), this._personProcessingSetOncePropertiesSent = false, this.version = n.LIB_VERSION, this._internalEventEmitter = new ia(), this._extensions = [], this._calculate_event_properties = this.calculateEventProperties.bind(this), this.config = $a(), this.SentryIntegration = rn, this.sentryIntegration = (e3) => function(e4, t3) {
        var i2 = tn(e4, t3);
        return { name: en, processEvent: (e5) => i2(e5) };
      }(this, e3), this.__request_queue = [], this.__loaded = false, this.analyticsDefaultEndpoint = "/e/", this._initialPageviewCaptured = false, this._visibilityStateListener = null, this._initialPersonProfilesConfig = null, this._cachedPersonProperties = null, this.scrollManager = new Xo(this), this.pageViewManager = new sn(this), this.rateLimiter = new Yn(this), this.requestRouter = new ga(this), this.consent = new os(this), this.externalIntegrations = new xa(this);
      var t2 = null !== (e2 = _Ba.__defaultExtensionClasses) && void 0 !== e2 ? e2 : {};
      this.featureFlags = t2.featureFlags && new t2.featureFlags(this), this.toolbar = t2.toolbar && new t2.toolbar(this), this.surveys = t2.surveys && new t2.surveys(this), this.conversations = t2.conversations && new t2.conversations(this), this.logs = t2.logs && new t2.logs(this), this.metrics = t2.metrics && new t2.metrics(this), this.experiments = t2.experiments && new t2.experiments(this), this.exceptions = t2.exceptions && new t2.exceptions(this), this.people = { set: (e3, t3, i2) => {
        var r2 = ut(e3) ? { [e3]: t3 } : e3;
        this.setPersonProperties(r2), null == i2 || i2({});
      }, set_once: (e3, t3, i2) => {
        var r2 = ut(e3) ? { [e3]: t3 } : e3;
        this.setPersonProperties(void 0, r2), null == i2 || i2({});
      } }, this.on("eventCaptured", (e3) => Tr.info('send "' + (null == e3 ? void 0 : e3.event) + '"', e3));
    }
    init(e2, t2, i2) {
      if (i2 && i2 !== Ma) {
        var r2, s2 = null !== (r2 = ka[i2]) && void 0 !== r2 ? r2 : new _Ba();
        return s2._init(e2, t2, i2), ka[i2] = s2, ka[Ma][i2] = s2, s2;
      }
      return this._init(e2, t2, i2);
    }
    _init(e2, t2, r2) {
      var s2, o2;
      void 0 === t2 && (t2 = {});
      var a2 = ut(e2) ? e2.trim() : "";
      if (!a2) return Tr.critical("PostHog was initialized without a token. This likely indicates a misconfiguration. Please check the first argument passed to posthog.init()"), this;
      if (this.__loaded) return console.warn("[PostHog.js]", "You have already initialized PostHog! Re-initializing is a no-op"), this;
      this.__loaded = true, this.config = $a(t2.defaults), t2.debug = this._checkLocalStorageForDebug(t2.debug), this._originalUserConfig = t2, this._triggered_notifs = [], t2.person_profiles ? this._initialPersonProfilesConfig = t2.person_profiles : t2.process_person && (this._initialPersonProfilesConfig = t2.process_person);
      var l2 = $a(t2.defaults), c2 = Da(t2), d2 = Mr({}, l2, c2, { name: r2, token: a2 });
      ot(l2.rageclick) && ot(c2.rageclick) && (d2.rageclick = Mr({}, l2.rageclick, c2.rageclick)), ot(l2.session_recording) && ot(c2.session_recording) && (d2.session_recording = Mr({}, l2.session_recording, c2.session_recording)), this.set_config(d2), this.config.on_xhr_error && Tr.error("on_xhr_error is deprecated. Use on_request_error instead"), this.compression = t2.disable_compression ? void 0 : eo.GZipJS;
      var _2 = this._is_persistence_disabled();
      this.persistence = new An(this.config, _2), this.sessionPersistence = "sessionStorage" === this.config.persistence || "memory" === this.config.persistence ? this.persistence : new An(i({}, this.config, { persistence: "sessionStorage" }), _2, false);
      var h2 = i({}, this.persistence.props), p2 = i({}, this.sessionPersistence.props);
      this.register({ $initialization_time: (/* @__PURE__ */ new Date()).toISOString() }), this._requestQueue = new Yo((e3) => this._send_retriable_request(e3), this.config.request_queue_config), this._retryQueue = new Zo(this), this.__request_queue = [];
      var g2 = this._inCookielessMode();
      if (g2 || (this.sessionManager = new sa(this), this.sessionPropsManager = new ta(this, this.sessionManager, this.persistence)), this.config.__preview_deferred_init_extensions ? (Tr.info("Deferring extension initialization to improve startup performance"), setTimeout(() => {
        this._initExtensions(g2);
      }, 0)) : (Tr.info("Initializing extensions synchronously"), this._initExtensions(g2)), n.DEBUG = n.DEBUG || this.config.debug, n.DEBUG && Tr.info("Starting in debug mode", { this: this, config: t2, thisC: i({}, this.config), p: h2, s: p2 }), !this.config.identity_distinct_id || null != (s2 = t2.bootstrap) && s2.distinctID || (t2.bootstrap = i({}, t2.bootstrap, { distinctID: this.config.identity_distinct_id, isIdentifiedID: true })), void 0 !== (null == (o2 = t2.bootstrap) ? void 0 : o2.distinctID)) {
        var v2 = t2.bootstrap.distinctID, f2 = this.get_distinct_id(), m2 = this.persistence.get_property(Y);
        if (t2.bootstrap.isIdentifiedID && null != f2 && f2 !== v2 && m2 === de) this.identify(v2);
        else if (t2.bootstrap.isIdentifiedID && null != f2 && f2 !== v2 && m2 === _e) Tr.warn("Bootstrap distinctID differs from an already-identified user. The existing identity is preserved. Call reset() before reinitializing if you intend to switch users.");
        else {
          var y2 = this.config.get_device_id(Kr()), b2 = t2.bootstrap.isIdentifiedID ? y2 : v2;
          this.persistence.set_property(Y, t2.bootstrap.isIdentifiedID ? _e : de), this.register({ distinct_id: v2, $device_id: b2 });
        }
      }
      if (g2) this.register_once({ distinct_id: re, $device_id: null }, "");
      else if (!this.get_distinct_id()) {
        var w2 = this.config.get_device_id(Kr());
        this.register_once({ distinct_id: w2, $device_id: w2 }, ""), this.persistence.set_property(Y, de);
      }
      return qr(be, "onpagehide" in self ? "pagehide" : "unload", this._handle_unload.bind(this), { passive: false }), t2.segment ? function(e3, t3) {
        var i2 = e3.config.segment;
        if (!i2) return t3();
        !function(e4, t4) {
          var i3 = e4.config.segment;
          if (!i3) return t4();
          var r3 = (i4) => {
            var r4 = () => i4.anonymousId() || Kr();
            e4.config.get_device_id = r4, i4.id() && (e4.register({ distinct_id: i4.id(), $device_id: r4() }), e4.persistence.set_property(Y, _e)), t4();
          }, s3 = i3.user();
          "then" in s3 && nt(s3.then) ? s3.then(r3) : r3(s3);
        }(e3, () => {
          i2.register(((e4) => {
            "undefined" != typeof Promise && Promise.resolve || Xs.warn("This browser does not have Promise support, and can not use the segment integration");
            var t4 = (t5, i3) => {
              if (!i3) return t5;
              t5.event.userId || t5.event.anonymousId === e4.get_distinct_id() || (Xs.info("No userId set, resetting PostHog"), e4.reset()), t5.event.userId && t5.event.userId !== e4.get_distinct_id() && (Xs.info("UserId set, identifying with PostHog"), e4.identify(t5.event.userId));
              var r3 = e4.calculateEventProperties(i3, t5.event.properties);
              return t5.event.properties = Object.assign({}, r3, t5.event.properties), t5;
            };
            return { name: "PostHog JS", type: "enrichment", version: "1.0.0", isLoaded: () => true, load: () => Promise.resolve(), track: (e5) => t4(e5, e5.event.event), page: (e5) => t4(e5, ve), identify: (e5) => t4(e5, me), screen: (e5) => t4(e5, "$screen") };
          })(e3)).then(() => {
            t3();
          });
        });
      }(this, () => this._loaded()) : this._loaded(), nt(this.config._onCapture) && this.config._onCapture !== Ia && (Tr.warn("onCapture is deprecated. Please use `before_send` instead"), this.on("eventCaptured", (e3) => this.config._onCapture(e3.event, e3))), this.config.ip && Tr.warn('The `ip` config option has NO EFFECT AT ALL and has been deprecated. Use a custom transformation or "Discard IP data" project setting instead. See https://posthog.com/tutorials/web-redact-properties#hiding-customer-ip-address for more information.'), this.config.disableDeviceModel || function() {
        return oa.apply(this, arguments);
      }().then((e3) => {
        e3 && this.register({ [u]: e3 });
      }).catch(Ia), this;
    }
    _initExtensions(e2) {
      var t2, r2, s2, n2, o2, a2, l2, u2, c2 = performance.now(), d2 = i({}, _Ba.__defaultExtensionClasses, this.config.__extensionClasses), _2 = [];
      d2.featureFlags && this._extensions.push(this.featureFlags = null !== (t2 = this.featureFlags) && void 0 !== t2 ? t2 : new d2.featureFlags(this)), d2.exceptions && this._extensions.push(this.exceptions = null !== (r2 = this.exceptions) && void 0 !== r2 ? r2 : new d2.exceptions(this)), d2.historyAutocapture && this._extensions.push(this.historyAutocapture = new d2.historyAutocapture(this)), d2.tracingHeaders && this._extensions.push(this.tracingHeaders = new d2.tracingHeaders(this)), d2.siteApps && this._extensions.push(this.siteApps = new d2.siteApps(this)), d2.sessionRecording && !e2 && this._extensions.push(this.sessionRecording = new d2.sessionRecording(this)), this.config.disable_scroll_properties || _2.push(() => {
        this.scrollManager.startMeasuringScrollPosition();
      }), d2.autocapture && this._extensions.push(this.autocapture = new d2.autocapture(this)), d2.surveys && this._extensions.push(this.surveys = null !== (s2 = this.surveys) && void 0 !== s2 ? s2 : new d2.surveys(this)), d2.logs && this._extensions.push(this.logs = null !== (n2 = this.logs) && void 0 !== n2 ? n2 : new d2.logs(this)), d2.metrics && this._extensions.push(this.metrics = null !== (o2 = this.metrics) && void 0 !== o2 ? o2 : new d2.metrics(this)), d2.conversations && this._extensions.push(this.conversations = null !== (a2 = this.conversations) && void 0 !== a2 ? a2 : new d2.conversations(this)), d2.productTours && this._extensions.push(this.productTours = new d2.productTours(this)), d2.heatmaps && this._extensions.push(this.heatmaps = new d2.heatmaps(this)), d2.webVitalsAutocapture && this._extensions.push(this.webVitalsAutocapture = new d2.webVitalsAutocapture(this)), d2.exceptionObserver && this._extensions.push(this.exceptionObserver = new d2.exceptionObserver(this)), d2.deadClicksAutocapture && this._extensions.push(this.deadClicksAutocapture = new d2.deadClicksAutocapture(this, Js)), d2.toolbar && this._extensions.push(this.toolbar = null !== (l2 = this.toolbar) && void 0 !== l2 ? l2 : new d2.toolbar(this)), d2.experiments && this._extensions.push(this.experiments = null !== (u2 = this.experiments) && void 0 !== u2 ? u2 : new d2.experiments(this)), this._extensions.forEach((e3) => {
        e3.initialize && _2.push(() => {
          null == e3.initialize || e3.initialize();
        });
      }), _2.push(() => {
        if (this._pendingRemoteConfig) {
          var e3 = this._pendingRemoteConfig;
          this._pendingRemoteConfig = void 0, this._onRemoteConfig(e3);
        }
      }), this._processInitTaskQueue(_2, c2);
    }
    _processInitTaskQueue(e2, t2) {
      for (; e2.length > 0; ) {
        if (this.config.__preview_deferred_init_extensions && performance.now() - t2 >= 30 && e2.length > 0) return void setTimeout(() => {
          this._processInitTaskQueue(e2, t2);
        }, 0);
        var i2 = e2.shift();
        if (i2) try {
          i2();
        } catch (e3) {
          Tr.error("Error initializing extension:", e3);
        }
      }
      var r2 = Math.round(performance.now() - t2);
      this.register_for_session({ [ne]: this.config.__preview_deferred_init_extensions ? "deferred" : "synchronous", [oe]: r2 }), this.config.__preview_deferred_init_extensions && Tr.info("PostHog extensions initialized (" + r2 + "ms)");
    }
    _onRemoteConfig(e2) {
      if (!Ee || !Ee.body) return Tr.info("document not ready yet, trying again in 500 milliseconds..."), void setTimeout(() => {
        this._onRemoteConfig(e2);
      }, 500);
      if (this.config.__preview_deferred_init_extensions && (this._pendingRemoteConfig = e2), this._lastRemoteConfig = e2, this.compression = void 0, e2.ok) {
        var t2, i2 = e2.config;
        i2.supportedCompression && !this.config.disable_compression && (this.compression = Je(i2.supportedCompression, eo.GZipJS) ? eo.GZipJS : Je(i2.supportedCompression, eo.Base64) ? eo.Base64 : void 0), null != (t2 = i2.analytics) && t2.endpoint && (this.analyticsDefaultEndpoint = i2.analytics.endpoint);
      }
      this.set_config({ person_profiles: this._initialPersonProfilesConfig ? this._initialPersonProfilesConfig : he }), this._extensions.forEach((t3) => null == t3.onRemoteConfig ? void 0 : t3.onRemoteConfig(e2));
    }
    _loaded() {
      try {
        this.config.loaded(this);
      } catch (e3) {
        Tr.critical("`loaded` function failed", e3);
      }
      if (this._start_queue_if_opted_in(), this.config.internal_or_test_user_hostname && null != xe && xe.hostname) {
        var e2 = xe.hostname, t2 = this.config.internal_or_test_user_hostname;
        ("string" == typeof t2 ? e2 === t2 : t2.test(e2)) && this.setInternalOrTestUser();
      }
      this.config.capture_pageview && setTimeout(() => {
        (this.consent.isOptedIn() || this._inCookielessMode()) && this._captureInitialPageview();
      }, 1), this._remoteConfigLoader = new Zn(this), this._remoteConfigLoader.load();
    }
    _start_queue_if_opted_in() {
      var e2;
      this.is_capturing() && this.config.request_batching && (null == (e2 = this._requestQueue) || e2.enable());
    }
    _dom_loaded() {
      this.is_capturing() && Rr(this.__request_queue, (e2) => this._send_retriable_request(e2)), this.__request_queue = [], this._start_queue_if_opted_in();
    }
    _handle_unload() {
      var e2, t2, i2, r2, s2;
      null == (e2 = this.surveys) || null == e2.handlePageUnload || e2.handlePageUnload(), null == (t2 = this.metrics) || t2.flush("sendBeacon"), this.config.request_batching ? (this._shouldCapturePageleave() && this.capture(fe), null == (i2 = this.logs) || i2.flushLogs("sendBeacon"), null == (r2 = this._requestQueue) || r2.unload(), null == (s2 = this._retryQueue) || s2.unload()) : this._shouldCapturePageleave() && this.capture(fe, null, { transport: "sendBeacon" });
    }
    _send_request(e2) {
      this.__loaded ? Aa ? this.__request_queue.push(e2) : this.rateLimiter.isServerRateLimited(e2.batchKey) ? e2.fireCallbackOnDrop && (null == e2.callback || e2.callback({ statusCode: 429 })) : (e2.transport = e2.transport || this.config.api_transport, e2.headers = i({}, this.config.request_headers, e2.headers), e2.compression = "best-available" === e2.compression ? this.compression : e2.compression, (lt(this.config.disable_beacon) ? this.config.__preview_disable_beacon : this.config.disable_beacon) && (e2.disableTransport = ["sendBeacon"]), e2.fetchOptions = e2.fetchOptions || this.config.fetch_options, ((e3) => {
        var t2, r2, s2, n2 = i({}, e3);
        n2.timeout = n2.timeout || 6e4;
        var o2 = null !== (t2 = n2.transport) && void 0 !== t2 ? t2 : "fetch";
        "sendBeacon" === o2 && lt(n2.compression) && n2.data && (n2.compression = eo.Base64), "body" === n2.timestampMode && "POST" === n2.method && n2.data && !st(n2.data) && (n2.data = i({}, n2.data, { sent_at: (/* @__PURE__ */ new Date()).toISOString() })), n2.url = Go(n2.url, n2.method, n2.compression, n2.timestampMode);
        var a2 = Ko.filter((e4) => !n2.disableTransport || !e4.transport || !n2.disableTransport.includes(e4.transport)), l2 = null !== (r2 = null == (s2 = function(e4, t3) {
          for (var i2 = 0; e4.length > i2; i2++) if (e4[i2].transport === o2) return e4[i2];
        }(a2)) ? void 0 : s2.method) && void 0 !== r2 ? r2 : a2[0].method;
        if (!l2) throw new Error("No available transport method");
        "sendBeacon" !== o2 && n2.data && n2.compression === eo.GZipJS && Ce && "undefined" != typeof Promise && !Oo ? Ho(n2).then((e4) => {
          l2(e4);
        }).catch((t3) => {
          if (Ve(t3)) return Oo = true, void l2(i({}, n2, { compression: void 0, url: Go(e3.url, e3.method, void 0, e3.timestampMode) }));
          ((e4) => {
            if (!e4 || "object" != typeof e4) return false;
            var t4 = "name" in e4 ? String(e4.name) : "";
            return Ve(e4) || t4 === He;
          })(t3) && (Oo = true), l2(n2);
        }) : l2(n2);
      })(i({}, e2, { callback: (t2) => {
        var i2, r2;
        this.rateLimiter.checkForLimiting(t2), 400 > t2.statusCode || null == (i2 = (r2 = this.config).on_request_error) || i2.call(r2, t2), null == e2.callback || e2.callback(t2);
      } }))) : e2.fireCallbackOnDrop && (null == e2.callback || e2.callback({ statusCode: 0 }));
    }
    _send_retriable_request(e2) {
      this._retryQueue ? this._retryQueue.retriableRequest(e2) : this._send_request(e2);
    }
    _execute_array(e2) {
      Pa++;
      try {
        var t2, i2 = [], r2 = [], s2 = [];
        Rr(e2, (e3) => {
          if (e3) if (st(t2 = e3[0])) s2.push(e3);
          else if (nt(e3)) try {
            e3.call(this);
          } catch (t3) {
            Tr.error("Error executing queued PostHog call", e3, t3);
          }
          else st(e3) && "alias" === t2 ? i2.push(e3) : st(e3) && -1 !== t2.indexOf("capture") && nt(this[t2]) ? s2.push(e3) : r2.push(e3);
        });
        var n2 = function(e3, t3) {
          Rr(e3, function(e4) {
            try {
              if (st(e4[0])) {
                var i3 = t3;
                Lr(e4, function(e5) {
                  i3 = i3[e5[0]].apply(i3, e5.slice(1));
                });
              } else t3[e4[0]].apply(t3, e4.slice(1));
            } catch (t4) {
              Tr.error("Error executing queued PostHog call", e4, t4);
            }
          });
        };
        n2(i2, this), n2(r2, this), n2(s2, this);
      } finally {
        Pa--;
      }
    }
    push(e2) {
      if (Pa > 0 && st(e2) && ut(e2[0])) {
        var t2 = _Ba.prototype[e2[0]];
        nt(t2) && t2.apply(this, e2.slice(1));
      } else this._execute_array([e2]);
    }
    capture(e2, t2, r2) {
      var s2, n2, o2, a2, l2;
      if (this.__loaded && this.persistence && this.sessionPersistence && this._requestQueue) {
        if (this.is_capturing()) if (!lt(e2) && ut(e2)) {
          var u2 = !this.config.opt_out_useragent_filter && this._is_bot();
          if (!u2 || this.config.__preview_capture_bot_pageviews) {
            var c2 = null != r2 && r2.skip_client_rate_limiting ? void 0 : this.rateLimiter.clientRateLimitContext();
            if (null == c2 || !c2.isRateLimited) {
              null != t2 && t2.$current_url && !ut(null == t2 ? void 0 : t2.$current_url) && (Tr.error("Invalid `$current_url` property provided to `posthog.capture`. Input must be a string. Ignoring provided value."), null == t2 || delete t2.$current_url), "$exception" !== e2 || null != r2 && r2._originatedFromCaptureException || Tr.warn("Using `posthog.capture('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureException(error)` instead, which attaches required metadata automatically."), this.sessionPersistence.update_search_keyword(), this.config.save_campaign_params && this.sessionPersistence.update_campaign_params(), this.config.save_referrer && this.sessionPersistence.update_referrer_info(), (this.config.save_campaign_params || this.config.save_referrer) && this.persistence.set_initial_person_info();
              var d2 = /* @__PURE__ */ new Date(), _2 = (null == r2 ? void 0 : r2.timestamp) || d2, h2 = Li(null == r2 ? void 0 : r2.uuid, Kr), p2 = { uuid: h2, event: e2, properties: this.calculateEventProperties(e2, t2 || {}, _2, h2) };
              e2 === ve && this.config.__preview_capture_bot_pageviews && u2 && (p2.event = "$bot_pageview", p2.properties.$browser_type = "bot"), c2 && (p2.properties.$lib_rate_limit_remaining_tokens = c2.remainingTokens);
              var g2 = "$feature_flag_called" === e2 && false === p2.properties.$feature_flag_has_experiment && true === this.get_property(O);
              (null == r2 ? void 0 : r2.$set) && !g2 && (p2.$set = null == r2 ? void 0 : r2.$set);
              var v2 = null == r2 ? void 0 : r2.$unset;
              v2 && (p2.$unset = v2);
              var f2, m2, y2, b2 = g2 ? void 0 : this._calculate_set_once_properties(null == r2 ? void 0 : r2.$set_once, e2 !== ye, e2 === me);
              if (b2 && (p2.$set_once = b2), null != r2 && r2._noTruncate || (n2 = this.config.properties_string_max_length, o2 = p2, a2 = (e3) => ut(e3) ? e3.slice(0, n2) : e3, l2 = /* @__PURE__ */ new Set(), p2 = function e3(t3, i2) {
                if (t3 !== Object(t3)) return a2 ? a2(t3) : t3;
                if (!l2.has(t3)) {
                  var r3;
                  if (l2.add(t3), st(t3)) r3 = [], Rr(t3, (t4) => {
                    r3.push(e3(t4));
                  });
                  else {
                    var s3 = {};
                    Lr(t3, (t4, i3) => {
                      l2.has(t4) || (s3[i3] = e3(t4, i3));
                    }), r3 = s3;
                  }
                  return r3;
                }
              }(o2)), p2.timestamp = _2, lt(null == r2 ? void 0 : r2.timestamp) || (p2.properties.$event_time_override_provided = true, p2.properties.$event_time_override_system_time = d2), g2 && (p2.properties = function(e3, t3) {
                void 0 === t3 && (t3 = []);
                var i2 = {}, r3 = (t4) => {
                  void 0 !== e3[t4] && (i2[t4] = e3[t4]);
                };
                return De.forEach(r3), t3.forEach(r3), i2;
              }(p2.properties, La)), e2 === zn.DISMISSED || e2 === zn.SENT) {
                var w2 = null == t2 ? void 0 : t2[jn.SURVEY_ID], S2 = null == t2 ? void 0 : t2[jn.SURVEY_ITERATION];
                ya({ id: w2, current_iteration: S2 }), p2.$set = i({}, p2.$set, { [(f2 = { id: w2, current_iteration: S2 }, m2 = e2 === zn.SENT ? "responded" : "dismissed", y2 = "$survey_" + m2 + "/" + f2.id, f2.current_iteration && f2.current_iteration > 0 && (y2 = "$survey_" + m2 + "/" + f2.id + "/" + f2.current_iteration), y2)]: true });
              } else e2 === zn.SHOWN && (p2.$set = i({}, p2.$set, { [jn.SURVEY_LAST_SEEN_DATE]: (/* @__PURE__ */ new Date()).toISOString() }));
              if (e2 === Gn.SHOWN) {
                var E2 = null == t2 ? void 0 : t2[Kn.TOUR_TYPE];
                E2 && (p2.$set = i({}, p2.$set, { [Kn.TOUR_LAST_SEEN_DATE + "/" + E2]: (/* @__PURE__ */ new Date()).toISOString() }));
              }
              var x2 = i({}, p2.properties.$set, p2.$set);
              if (at(x2) || this.setPersonPropertiesForFlags(x2), !_t(this.config.before_send)) {
                var k2 = this._runBeforeSend(p2);
                if (!k2) return;
                (p2 = k2).uuid = Li(p2.uuid, Kr);
              }
              this._internalEventEmitter.emit("eventCaptured", p2);
              var P2 = { method: "POST", url: null !== (s2 = null == r2 ? void 0 : r2._url) && void 0 !== s2 ? s2 : this.requestRouter.endpointFor("api", this.analyticsDefaultEndpoint), data: p2, compression: "best-available", timestampMode: "query", batchKey: null == r2 ? void 0 : r2._batchKey, transport: null == r2 ? void 0 : r2.transport };
              return !this.config.request_batching || r2 && (null == r2 || !r2._batchKey) || null != r2 && r2.send_instantly ? this._send_retriable_request(P2) : this._requestQueue.enqueue(P2), p2;
            }
            Tr.critical("This capture call is ignored due to client rate limiting.");
          }
        } else Tr.error("No event name provided to posthog.capture");
      } else Tr.uninitializedWarning("posthog.capture");
    }
    _addCaptureHook(e2) {
      return this.on("eventCaptured", (t2) => e2(t2.event, t2));
    }
    calculateEventProperties(e2, t2, r2, s2, o2) {
      if (r2 = r2 || /* @__PURE__ */ new Date(), !this.persistence || !this.sessionPersistence) return t2;
      var a2 = o2 ? void 0 : this.persistence.remove_event_timer(e2), l2 = i({}, t2);
      if (l2.token = this.config.token, l2.$config_defaults = this.config.defaults, this._inCookielessMode() && (l2[se] = true), "$snapshot" === e2) {
        var u2 = i({}, this.persistence.properties(), this.sessionPersistence.properties());
        return l2.distinct_id = u2.distinct_id, (!ut(l2.distinct_id) && !ht(l2.distinct_id) || ct(l2.distinct_id)) && Tr.error("Invalid distinct_id for replay event. This indicates a bug in your implementation"), l2;
      }
      var c2, d2 = function(e3, t3, i2, r3) {
        var s3, o3, a3, l3;
        if (void 0 === r3 && (r3 = false), !Te) return {};
        var u3, c3 = e3 ? [...fn, ...t3 || []] : [], d3 = function(e4) {
          for (var t4 = 0; Ti.length > t4; t4++) {
            var i3 = Ti[t4], r4 = i3[1], s4 = i3[0].exec(e4), n2 = s4 && (nt(r4) ? r4(s4, e4) : r4);
            if (n2) return n2;
          }
          return ["", ""];
        }(Te), _3 = d3[0], h3 = d3[1], p3 = null != (u3 = "undefined" != typeof navigator ? navigator : void 0) && u3.brave ? { brave: true } : {}, g3 = {};
        lt(i2) || (g3.detectGoogleSearchApp = i2);
        var v3 = {}, f3 = null == (s3 = navigator) || null == (s3 = s3.userAgentData) ? void 0 : s3.platform, m3 = null == (o3 = navigator) ? void 0 : o3.maxTouchPoints, y3 = null == be || null == (a3 = be.screen) ? void 0 : a3.width, b2 = null == be || null == (l3 = be.screen) ? void 0 : l3.height, w2 = null == be ? void 0 : be.devicePixelRatio;
        lt(f3) || (v3.userAgentDataPlatform = f3), lt(m3) || (v3.maxTouchPoints = m3), lt(y3) || (v3.screenWidth = y3), lt(b2) || (v3.screenHeight = b2), lt(w2) || (v3.devicePixelRatio = w2);
        var S2, E2, x2, k2, P2, I2, C2, T2, F2 = Mr(Dr({ $os: _3, $os_version: h3, $browser: Pi(Te, navigator.vendor, p3, g3), $device: Fi(Te), $device_type: (E2 = Te, x2 = v3, T2 = Fi(E2), T2 === Lt || T2 === Rt || "Kobo" === T2 || "Kindle Fire" === T2 || T2 === li ? Ft : T2 === Jt || T2 === Xt || T2 === Zt || T2 === ni ? "Console" : T2 === At ? "Wearable" : T2 ? It : "Android" === (null == x2 ? void 0 : x2.userAgentDataPlatform) && (null !== (k2 = null == x2 ? void 0 : x2.maxTouchPoints) && void 0 !== k2 ? k2 : 0) > 0 ? 600 > Math.min(null !== (P2 = null == x2 ? void 0 : x2.screenWidth) && void 0 !== P2 ? P2 : 0, null !== (I2 = null == x2 ? void 0 : x2.screenHeight) && void 0 !== I2 ? I2 : 0) / (null !== (C2 = null == x2 ? void 0 : x2.devicePixelRatio) && void 0 !== C2 ? C2 : 1) ? It : Ft : "Desktop"), $timezone: Tn(), $timezone_offset: Fn() }), { $current_url: _n(r3 ? Mi(null == xe ? void 0 : xe.href) : null == xe ? void 0 : xe.href, c3, yn), $host: null == xe ? void 0 : xe.host, $pathname: null == xe ? void 0 : xe.pathname, $raw_user_agent: Te.length > 1e3 ? Te.substring(0, 997) + "..." : Te, $browser_version: Ci(Te, navigator.vendor, p3, g3), $browser_language: xn(), $browser_language_prefix: (S2 = xn(), "string" == typeof S2 ? S2.split("-")[0] : void 0), $screen_height: null == be ? void 0 : be.screen.height, $screen_width: null == be ? void 0 : be.screen.width, $viewport_height: null == be ? void 0 : be.innerHeight, $viewport_width: null == be ? void 0 : be.innerWidth, $lib: n.LIB_NAME, $lib_version: n.LIB_VERSION, $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10), $time: Date.now() / 1e3 });
        return n.SDK_DIST_CHANNEL && (F2.$sdk_dist_channel = n.SDK_DIST_CHANNEL), F2;
      }(this.config.mask_personal_data_properties, this.config.custom_personal_data_properties, this.config.detect_google_search_app, this.config.disable_capture_url_hashes);
      if (this.sessionManager) {
        var _2 = this.sessionManager.checkAndGetSessionAndWindowId(o2, r2.getTime()), h2 = _2.windowId;
        l2.$session_id = _2.sessionId, l2.$window_id = h2;
      }
      this.sessionPropsManager && Mr(l2, this.sessionPropsManager.getSessionProps());
      try {
        var p2;
        this.sessionRecording && Mr(l2, this.sessionRecording.sdkDebugProperties), l2.$sdk_debug_retry_queue_size = null == (p2 = this._retryQueue) ? void 0 : p2.length;
      } catch (e3) {
        l2.$sdk_debug_error_capturing_properties = String(e3);
      }
      if (this.requestRouter.region === _a && (l2.$lib_custom_api_host = this.config.api_host), c2 = e2 !== ve || o2 ? e2 !== fe || o2 ? this.pageViewManager.doEvent() : this.pageViewManager.doPageLeave(r2) : this.pageViewManager.doPageView(r2, s2), l2 = Mr(l2, c2), e2 === ve && Ee && (l2.title = Ee.title), !lt(a2)) {
        var g2 = r2.getTime() - a2;
        l2.$duration = parseFloat((g2 / 1e3).toFixed(3));
      }
      Te && this.config.opt_out_useragent_filter && (l2.$browser_type = this._is_bot() ? "bot" : "browser");
      var v2 = this.persistence.properties(), f2 = this.sessionPersistence.properties();
      Lr(["$referrer", "$referring_domain"], (e3) => {
        e3 in v2 && delete f2[e3];
      }), (l2 = Mr({}, d2, v2, f2, l2)).$is_identified = this._isIdentified(), st(this.config.property_denylist) ? Lr(this.config.property_denylist, function(e3) {
        delete l2[e3];
      }) : Tr.error(Ra + this.config.property_denylist + " or property_blacklist config: " + this.config.property_blacklist);
      var m2 = this.config.sanitize_properties;
      m2 && (Tr.error(Fa), l2 = m2(l2, e2));
      var y2 = this._hasPersonProcessing();
      return l2.$process_person_profile = y2, y2 && !o2 && this._requirePersonProcessing("_calculate_event_properties"), l2;
    }
    _calculate_set_once_properties(e2, t2, i2) {
      var r2;
      if (void 0 === t2 && (t2 = true), void 0 === i2 && (i2 = false), !this.persistence || !this._hasPersonProcessing()) return e2;
      if (this._personProcessingSetOncePropertiesSent && !i2) return e2;
      var s2 = this.persistence.get_initial_props(), n2 = null == (r2 = this.sessionPropsManager) ? void 0 : r2.getSetOnceProps(), o2 = Mr({}, s2, n2 || {}, e2 || {}), a2 = this.config.sanitize_properties;
      return a2 && (Tr.error(Fa), o2 = a2(o2, "$set_once")), t2 && (this._personProcessingSetOncePropertiesSent = true), at(o2) ? void 0 : o2;
    }
    register(e2, t2) {
      var i2;
      null == (i2 = this.persistence) || i2.register(e2, t2);
    }
    register_once(e2, t2, i2) {
      var r2;
      null == (r2 = this.persistence) || r2.register_once(e2, t2, i2);
    }
    register_for_session(e2) {
      var t2;
      null == (t2 = this.sessionPersistence) || t2.register(e2);
    }
    unregister(e2) {
      var t2;
      null == (t2 = this.persistence) || t2.unregister(e2);
    }
    unregister_for_session(e2) {
      var t2;
      null == (t2 = this.sessionPersistence) || t2.unregister(e2);
    }
    _register_single(e2, t2) {
      this.register({ [e2]: t2 });
    }
    getFeatureFlag(e2, t2) {
      var i2;
      return null == (i2 = this.featureFlags) ? void 0 : i2.getFeatureFlag(e2, t2);
    }
    getFeatureFlagPayload(e2) {
      var t2;
      return null == (t2 = this.featureFlags) ? void 0 : t2.getFeatureFlagPayload(e2);
    }
    getFeatureFlagResult(e2, t2) {
      var i2;
      return null == (i2 = this.featureFlags) ? void 0 : i2.getFeatureFlagResult(e2, t2);
    }
    getAllFeatureFlags() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this.featureFlags) ? void 0 : t2.getAllFeatureFlags()) && void 0 !== e2 ? e2 : [];
    }
    isFeatureEnabled(e2, t2) {
      var i2, r2;
      return null !== (i2 = null == (r2 = this.featureFlags) ? void 0 : r2.isFeatureEnabled(e2, t2)) && void 0 !== i2 ? i2 : null == t2 ? void 0 : t2.defaultValue;
    }
    reloadFeatureFlags() {
      var e2;
      null == (e2 = this.featureFlags) || e2.reloadFeatureFlags();
    }
    updateFlags(e2, t2, i2) {
      var r2;
      null == (r2 = this.featureFlags) || r2.updateFlags(e2, t2, i2);
    }
    updateEarlyAccessFeatureEnrollment(e2, t2, i2) {
      var r2;
      null == (r2 = this.featureFlags) || r2.updateEarlyAccessFeatureEnrollment(e2, t2, i2);
    }
    getEarlyAccessFeatures(e2, t2, i2) {
      var r2;
      return void 0 === t2 && (t2 = false), null == (r2 = this.featureFlags) ? void 0 : r2.getEarlyAccessFeatures(e2, t2, i2);
    }
    on(e2, t2) {
      return this._internalEventEmitter.on(e2, t2);
    }
    onFeatureFlags(e2) {
      return this.featureFlags ? this.featureFlags.onFeatureFlags(e2) : (e2([], {}, { errorsLoading: true }), () => {
      });
    }
    onSurveysLoaded(e2) {
      return this.surveys ? this.surveys.onSurveysLoaded(e2) : (e2([], { isLoaded: false, error: Ta }), () => {
      });
    }
    onSessionId(e2) {
      var t2, i2;
      return null !== (t2 = null == (i2 = this.sessionManager) ? void 0 : i2.onSessionId(e2)) && void 0 !== t2 ? t2 : () => {
      };
    }
    getSurveys(e2, t2) {
      void 0 === t2 && (t2 = false), this.surveys ? this.surveys.getSurveys(e2, t2) : e2([], { isLoaded: false, error: Ta });
    }
    getActiveMatchingSurveys(e2, t2) {
      void 0 === t2 && (t2 = false), this.surveys ? this.surveys.getActiveMatchingSurveys(e2, t2) : e2([], { isLoaded: false, error: Ta });
    }
    renderSurvey(e2, t2) {
      var i2;
      null == (i2 = this.surveys) || i2.renderSurvey(e2, t2);
    }
    displaySurvey(e2, t2) {
      var i2;
      void 0 === t2 && (t2 = wa), null == (i2 = this.surveys) || i2.displaySurvey(e2, t2);
    }
    cancelPendingSurvey(e2) {
      var t2;
      null == (t2 = this.surveys) || t2.cancelPendingSurvey(e2);
    }
    canRenderSurvey(e2) {
      var t2, i2;
      return null !== (t2 = null == (i2 = this.surveys) ? void 0 : i2.canRenderSurvey(e2)) && void 0 !== t2 ? t2 : { visible: false, disabledReason: Ta };
    }
    canRenderSurveyAsync(e2, t2) {
      var i2, r2;
      return void 0 === t2 && (t2 = false), null !== (i2 = null == (r2 = this.surveys) ? void 0 : r2.canRenderSurveyAsync(e2, t2)) && void 0 !== i2 ? i2 : Promise.resolve({ visible: false, disabledReason: Ta });
    }
    _validateIdentifyId(e2) {
      return !e2 || ct(e2) ? (Tr.critical("Unique user id has not been set in posthog.identify"), false) : e2 === re ? (Tr.critical('The string "' + e2 + '" was set in posthog.identify which indicates an error. This ID is only used as a sentinel value.'), false) : !["distinct_id", "distinctid"].includes(e2.toLowerCase()) && !["undefined", "null"].includes(e2.toLowerCase()) || (Tr.critical('The string "' + e2 + '" was set in posthog.identify which indicates an error. This ID should be unique to the user and not a hardcoded string.'), false);
    }
    identify(e2, t2, i2) {
      if (!this.__loaded || !this.persistence) return Tr.uninitializedWarning("posthog.identify");
      if (ht(e2) && (e2 = e2.toString(), Tr.warn("The first argument to posthog.identify was a number, but it should be a string. It has been converted to a string.")), this._validateIdentifyId(e2) && this._requirePersonProcessing("posthog.identify")) {
        var r2 = this.get_distinct_id();
        this.register({ $user_id: e2 }), this.get_property(l) || this.register_once({ $had_persisted_distinct_id: true, $device_id: r2 }, ""), e2 !== r2 && e2 !== this.get_property(c) && (this.unregister(c), this.register({ distinct_id: e2 }));
        var s2, n2 = (this.persistence.get_property(Y) || de) === de;
        e2 !== r2 && n2 ? (this.persistence.set_property(Y, _e), this.setPersonPropertiesForFlags({ $set: t2 || {}, $set_once: i2 || {} }, false), this.capture(me, { distinct_id: e2, $anon_distinct_id: r2 }, { $set: t2 || {}, $set_once: i2 || {} }), this._cachedPersonProperties = la(e2, t2, i2), null == (s2 = this.featureFlags) || s2.setAnonymousDistinctId(r2)) : (t2 || i2) && this.setPersonProperties(t2, i2), e2 !== r2 && (this.reloadFeatureFlags(), this.unregister(W));
      }
    }
    setPersonProperties(e2, t2) {
      if ((e2 || t2) && this._requirePersonProcessing("posthog.setPersonProperties")) {
        var i2 = la(this.get_distinct_id(), e2, t2);
        this._cachedPersonProperties !== i2 ? (this.setPersonPropertiesForFlags({ $set: e2 || {}, $set_once: t2 || {} }, true), this.capture("$set", { $set: e2 || {}, $set_once: t2 || {} }), this._cachedPersonProperties = i2) : Tr.info("A duplicate setPersonProperties call was made with the same properties. It has been ignored.");
      }
    }
    unsetPersonProperties(e2) {
      var t2, i2 = (st(e2) ? e2 : [e2]).filter((e3) => ut(e3) && e3.length > 0);
      0 !== i2.length && this._requirePersonProcessing("posthog.unsetPersonProperties") && (null == (t2 = this.featureFlags) || t2.unsetPersonPropertiesForFlags(i2, true), this.capture("$set", { $unset: i2 }), this._cachedPersonProperties = null);
    }
    group(e2, t2, r2) {
      if (e2 && t2) {
        var s2 = this.getGroups(), n2 = s2[e2] !== t2;
        if (n2 && this.resetGroupPropertiesForFlags(e2), this.register({ $groups: i({}, s2, { [e2]: t2 }) }), n2 || r2) {
          var o2 = { $group_type: e2, $group_key: t2 };
          r2 && (o2.$group_set = r2), this.capture(ye, o2);
        }
        r2 && this.setGroupPropertiesForFlags({ [e2]: r2 }), n2 && !r2 && this.reloadFeatureFlags();
      } else Tr.error("posthog.group requires a group type and group key");
    }
    resetGroups() {
      this.register({ $groups: {} }), this.resetGroupPropertiesForFlags(), this.reloadFeatureFlags();
    }
    setPersonPropertiesForFlags(e2, t2) {
      var i2;
      void 0 === t2 && (t2 = true), null == (i2 = this.featureFlags) || i2.setPersonPropertiesForFlags(e2, t2);
    }
    resetPersonPropertiesForFlags(e2) {
      var t2;
      void 0 === e2 && (e2 = true), null == (t2 = this.featureFlags) || t2.resetPersonPropertiesForFlags(e2);
    }
    setGroupPropertiesForFlags(e2, t2) {
      var i2;
      void 0 === t2 && (t2 = true), this._requirePersonProcessing("posthog.setGroupPropertiesForFlags") && (null == (i2 = this.featureFlags) || i2.setGroupPropertiesForFlags(e2, t2));
    }
    resetGroupPropertiesForFlags(e2) {
      var t2;
      null == (t2 = this.featureFlags) || t2.resetGroupPropertiesForFlags(e2);
    }
    reset(e2) {
      var t2, i2, r2, s2, n2, o2, a2, c2, d2, _2;
      if (Tr.info("reset"), !this.__loaded) return Tr.uninitializedWarning("posthog.reset");
      var h2, p2 = this.get_property(l), g2 = this.get_property(u), v2 = this.get_property(w);
      if (this.consent.reset(), null == (t2 = this.persistence) || t2.clear(), null == (i2 = this.sessionPersistence) || i2.clear(), lt(v2) || null == (h2 = this.persistence) || h2.register({ [w]: v2 }), null == (r2 = this.surveys) || r2.reset(), null == (s2 = this._remoteConfigLoader) || s2.stop(), null == (n2 = this.featureFlags) || n2.reset(), null == (o2 = this.conversations) || o2.reset(), null == (a2 = this.logs) || a2.reset(), null == (c2 = this.metrics) || c2.reset(), null == (d2 = this.persistence) || d2.set_property(Y, de), null == (_2 = this.sessionManager) || _2.resetSessionId(), this._cachedPersonProperties = null, this.config.cookieless_mode === ce) this.register_once({ distinct_id: re, $device_id: null }, "");
      else {
        var f2 = this.config.get_device_id(Kr());
        this.register_once({ distinct_id: f2, $device_id: e2 ? f2 : p2 }, ""), e2 || lt(g2) || this.register({ [u]: g2 });
      }
      this.register({ $last_posthog_reset: (/* @__PURE__ */ new Date()).toISOString() }, 1), delete this.config.identity_distinct_id, delete this.config.identity_hash, this.reloadFeatureFlags();
    }
    shutdown(e2) {
      var i2 = this;
      return t(function* () {
        var e3, t2, r2, s2, n2;
        i2.__loaded ? (null == (e3 = i2.logs) || e3.flushLogs("sendBeacon"), null == (t2 = i2.metrics) || t2.flush("sendBeacon"), null == (r2 = i2._requestQueue) || r2.unload(), null == (s2 = i2._retryQueue) || s2.unload(), null == (n2 = i2.featureFlags) || n2.destroy()) : Tr.uninitializedWarning("posthog.shutdown");
      })();
    }
    setIdentity(e2, t2) {
      var i2;
      this.config.identity_distinct_id = e2, this.config.identity_hash = t2, this.alias(e2), null == (i2 = this.conversations) || i2._onIdentityChanged();
    }
    clearIdentity() {
      var e2;
      delete this.config.identity_distinct_id, delete this.config.identity_hash, null == (e2 = this.conversations) || e2._onIdentityCleared();
    }
    get_distinct_id() {
      return this.get_property("distinct_id");
    }
    getGroups() {
      return this.get_property("$groups") || {};
    }
    get_session_id() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this.sessionManager) ? void 0 : t2.checkAndGetSessionAndWindowId(true).sessionId) && void 0 !== e2 ? e2 : "";
    }
    get_session_replay_url(e2) {
      if (!this.sessionManager) return "";
      var t2 = this.sessionManager.checkAndGetSessionAndWindowId(true), i2 = t2.sessionStartTimestamp, r2 = this.requestRouter.endpointFor("ui", "/project/" + this.config.token + "/replay/" + t2.sessionId);
      if (null != e2 && e2.withTimestamp && i2) {
        var s2, n2 = null !== (s2 = e2.timestampLookBack) && void 0 !== s2 ? s2 : 10;
        if (!i2) return r2;
        r2 += "?t=" + Math.max(Math.floor(((/* @__PURE__ */ new Date()).getTime() - i2) / 1e3) - n2, 0);
      }
      return r2;
    }
    alias(e2, t2) {
      return e2 === this.get_property(a) ? (Tr.critical("Attempting to create alias for existing People user - aborting."), -2) : this._requirePersonProcessing("posthog.alias") ? (lt(t2) && (t2 = this.get_distinct_id()), e2 !== t2 ? (this._register_single(c, e2), this.capture("$create_alias", { alias: e2, distinct_id: t2 })) : (Tr.warn("alias matches current distinct_id - skipping api call."), this.identify(e2), -1)) : void 0;
    }
    set_config(e2) {
      var t2 = i({}, this.config);
      if (ot(e2)) {
        var r2, s2, o2, a2, l2, u2, c2, d2, _2, h2, p2;
        Mr(this.config, Da(e2));
        var g2 = this._is_persistence_disabled();
        null == (r2 = this.persistence) || r2.update_config(this.config, t2, g2), this.sessionPersistence = "sessionStorage" === this.config.persistence || "memory" === this.config.persistence ? this.persistence : new An(i({}, this.config, { persistence: "sessionStorage" }), g2, false);
        var v2 = this._checkLocalStorageForDebug(this.config.debug);
        gt(v2) && (this.config.debug = v2), gt(this.config.debug) && (this.config.debug ? (n.DEBUG = true, es._is_supported() && es._set("ph_debug", true), Tr.info("set_config", { config: e2, oldConfig: t2, newConfig: i({}, this.config) })) : (n.DEBUG = false, es._is_supported() && es._remove("ph_debug"))), null == (s2 = this.exceptionObserver) || s2.onConfigChange(), null == (o2 = this.exceptions) || o2.onConfigChange(), null == (a2 = this.sessionRecording) || a2.startIfEnabledOrStop(), null == (l2 = this.tracingHeaders) || l2.startIfEnabledOrStop(), null == (u2 = this.autocapture) || u2.startIfEnabled(), null == (c2 = this.heatmaps) || c2.startIfEnabled(), null == (d2 = this.exceptionObserver) || d2.startIfEnabledOrStop(), null == (_2 = this.deadClicksAutocapture) || _2.startIfEnabledOrStop(), null == (h2 = this.surveys) || h2.loadIfEnabled(), this._sync_opt_out_with_persistence(), null == (p2 = this.externalIntegrations) || p2.startIfEnabledOrStop();
      }
    }
    _overrideSDKInfo(e2, t2) {
      n.LIB_NAME = e2, n.LIB_VERSION = t2;
    }
    startSessionRecording(e2) {
      var t2, i2, r2, s2, n2, o2 = true === e2, a2 = { sampling: o2 || !(null == e2 || !e2.sampling), linked_flag: o2 || !(null == e2 || !e2.linked_flag), url_trigger: o2 || !(null == e2 || !e2.url_trigger), event_trigger: o2 || !(null == e2 || !e2.event_trigger) };
      Object.values(a2).some(Boolean) && (null == (t2 = this.sessionManager) || t2.checkAndGetSessionAndWindowId(), a2.sampling && (null == (i2 = this.sessionRecording) || i2.overrideSampling()), a2.linked_flag && (null == (r2 = this.sessionRecording) || r2.overrideLinkedFlag()), a2.url_trigger && (null == (s2 = this.sessionRecording) || s2.overrideTrigger("url")), a2.event_trigger && (null == (n2 = this.sessionRecording) || n2.overrideTrigger("event")));
      this.set_config({ disable_session_recording: false });
    }
    stopSessionRecording() {
      this.set_config({ disable_session_recording: true });
    }
    sessionRecordingStarted() {
      var e2;
      return !(null == (e2 = this.sessionRecording) || !e2.started);
    }
    captureException(e2, t2) {
      if (this.exceptions) {
        var r2 = new Error("PostHog syntheticException"), s2 = this.exceptions.buildProperties(e2, { handled: true, syntheticException: r2 });
        return this.exceptions.sendExceptionEvent(i({}, s2, t2));
      }
    }
    addExceptionStep(e2, t2) {
      var i2;
      null == (i2 = this.exceptions) || i2.addExceptionStep(e2, t2);
    }
    captureLog(e2) {
      var t2;
      null == (t2 = this.logs) || t2.captureLog(e2);
    }
    get logger() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this.logs) ? void 0 : t2.logger) && void 0 !== e2 ? e2 : _Ba._noopLogger;
    }
    startExceptionAutocapture(e2) {
      this.set_config({ capture_exceptions: null == e2 || e2 });
    }
    stopExceptionAutocapture() {
      this.set_config({ capture_exceptions: false });
    }
    loadToolbar(e2) {
      var t2, i2;
      return null !== (t2 = null == (i2 = this.toolbar) ? void 0 : i2.loadToolbar(e2)) && void 0 !== t2 && t2;
    }
    get_property(e2) {
      var t2;
      return null == (t2 = this.persistence) ? void 0 : t2.props[e2];
    }
    getSessionProperty(e2) {
      var t2;
      return null == (t2 = this.sessionPersistence) ? void 0 : t2.props[e2];
    }
    toString() {
      var e2, t2 = null !== (e2 = this.config.name) && void 0 !== e2 ? e2 : Ma;
      return t2 !== Ma && (t2 = Ma + "." + t2), t2;
    }
    _isIdentified() {
      var e2, t2;
      return (null == (e2 = this.persistence) ? void 0 : e2.get_property(Y)) === _e || (null == (t2 = this.sessionPersistence) ? void 0 : t2.get_property(Y)) === _e;
    }
    _hasPersonProcessing() {
      var e2, t2;
      return !("never" === this.config.person_profiles || this.config.person_profiles === he && !this._isIdentified() && at(this.getGroups()) && (null == (e2 = this.persistence) || null == (e2 = e2.props) || !e2[c]) && (null == (t2 = this.persistence) || null == (t2 = t2.props) || !t2[ie]));
    }
    _shouldCapturePageleave() {
      return true === this.config.capture_pageleave || "if_capture_pageview" === this.config.capture_pageleave && (true === this.config.capture_pageview || "history_change" === this.config.capture_pageview);
    }
    createPersonProfile() {
      this._hasPersonProcessing() || this._requirePersonProcessing("posthog.createPersonProfile") && this.setPersonProperties({}, {});
    }
    setInternalOrTestUser() {
      this._requirePersonProcessing("posthog.setInternalOrTestUser") && this.setPersonProperties({ $internal_or_test_user: true });
    }
    _requirePersonProcessing(e2) {
      return "never" === this.config.person_profiles ? (Tr.error(e2 + ' was called, but process_person is set to "never". This call will be ignored.'), false) : (this._register_single(ie, true), true);
    }
    _is_persistence_disabled() {
      if ("always" === this.config.cookieless_mode) return true;
      var e2 = this.consent.isOptedOut();
      return this.config.disable_persistence || e2 && !(!this.config.opt_out_persistence_by_default && this.config.cookieless_mode !== ue);
    }
    _sync_opt_out_with_persistence() {
      var e2, t2, i2, r2, s2 = this._is_persistence_disabled();
      return (null == (e2 = this.persistence) ? void 0 : e2._disabled) !== s2 && (null == (i2 = this.persistence) || i2.set_disabled(s2)), (null == (t2 = this.sessionPersistence) ? void 0 : t2._disabled) !== s2 && (null == (r2 = this.sessionPersistence) || r2.set_disabled(s2)), s2;
    }
    opt_in_capturing(e2) {
      var t2;
      if (this.config.cookieless_mode !== ce) {
        if (this._inCookielessMode()) {
          var i2, r2, s2, n2, o2;
          this.reset(true), null == (i2 = this.sessionManager) || i2.destroy(), null == (r2 = this.pageViewManager) || r2.destroy(), this.sessionManager = new sa(this), this.pageViewManager = new sn(this), this.persistence && (this.sessionPropsManager = new ta(this, this.sessionManager, this.persistence));
          var a2, l2 = null !== (s2 = null == (n2 = this.config.__extensionClasses) ? void 0 : n2.sessionRecording) && void 0 !== s2 ? s2 : null == (o2 = _Ba.__defaultExtensionClasses) ? void 0 : o2.sessionRecording;
          l2 && (this.sessionRecording = this._replaceExtension(this.sessionRecording, new l2(this)), this._lastRemoteConfig && (null == (a2 = this.sessionRecording) || null == a2.onRemoteConfig || a2.onRemoteConfig(this._lastRemoteConfig)));
        }
        var u2, c2;
        this.consent.optInOut(true), this._sync_opt_out_with_persistence(), this._start_queue_if_opted_in(), null == (t2 = this.sessionRecording) || t2.startIfEnabledOrStop(), this.config.cookieless_mode == ue && (null == (u2 = this.surveys) || u2.loadIfEnabled()), (lt(null == e2 ? void 0 : e2.captureEventName) || null != e2 && e2.captureEventName) && this.capture(null !== (c2 = null == e2 ? void 0 : e2.captureEventName) && void 0 !== c2 ? c2 : "$opt_in", null == e2 ? void 0 : e2.captureProperties, { send_instantly: true }), this.config.capture_pageview && this._captureInitialPageview();
      } else Tr.warn(Ca);
    }
    opt_out_capturing() {
      var e2, t2, i2;
      this.config.cookieless_mode !== ce ? (this.config.cookieless_mode === ue && this.consent.isOptedIn() && this.reset(true), this.consent.optInOut(false), this._sync_opt_out_with_persistence(), this.config.cookieless_mode === ue && (this.register({ distinct_id: re, $device_id: null }), null == (e2 = this.sessionRecording) || e2.stopRecording(), this.sessionRecording = void 0, null == (t2 = this.sessionManager) || t2.destroy(), null == (i2 = this.pageViewManager) || i2.destroy(), this.sessionManager = void 0, this.sessionPropsManager = void 0, this.config.capture_pageview && this._captureInitialPageview(), this._start_queue_if_opted_in())) : Tr.warn(Ca);
    }
    has_opted_in_capturing() {
      return this.consent.isOptedIn();
    }
    has_opted_out_capturing() {
      return this.consent.isOptedOut();
    }
    get_explicit_consent_status() {
      var e2 = this.consent.consent;
      return 1 === e2 ? "granted" : 0 === e2 ? "denied" : "pending";
    }
    is_capturing() {
      return this.config.cookieless_mode === ce || (this.config.cookieless_mode === ue ? this.consent.isRejected() || this.consent.isOptedIn() : !this.has_opted_out_capturing());
    }
    clear_opt_in_out_capturing() {
      this.consent.reset(), this._sync_opt_out_with_persistence();
    }
    _is_bot() {
      return Se ? na(Se, this.config.custom_blocked_useragents) : void 0;
    }
    _captureInitialPageview() {
      Ee && ("visible" === Ee.visibilityState ? this._initialPageviewCaptured || (this._initialPageviewCaptured = true, this.capture(ve, { title: Ee.title }, { send_instantly: true }), this._visibilityStateListener && (Ee.removeEventListener(pe, this._visibilityStateListener), this._visibilityStateListener = null)) : this._visibilityStateListener || (this._visibilityStateListener = this._captureInitialPageview.bind(this), qr(Ee, pe, this._visibilityStateListener)));
    }
    debug(e2) {
      false === e2 ? (null == be || be.console.log("You've disabled debug mode."), this.set_config({ debug: false })) : (null == be || be.console.log("You're now in debug mode. All calls to PostHog will be logged in your console.\nYou can disable this with `posthog.debug(false)`."), this.set_config({ debug: true }));
    }
    _shouldDisableFlags() {
      var e2 = this._originalUserConfig || {};
      return "advanced_disable_flags" in e2 ? !!e2.advanced_disable_flags : false !== this.config.advanced_disable_flags ? !!this.config.advanced_disable_flags : true === this.config.advanced_disable_decide ? (Tr.warn("Config field 'advanced_disable_decide' is deprecated. Please use 'advanced_disable_flags' instead. The old field will be removed in a future major version."), true) : function(e3, t2, i2, r2, s2) {
        var n2 = t2 in e3 && !_t(e3[t2]), o2 = i2 in e3 && !_t(e3[i2]);
        return n2 ? e3[t2] : !!o2 && (s2 && s2.warn("Config field '" + i2 + "' is deprecated. Please use '" + t2 + "' instead. The old field will be removed in a future major version."), e3[i2]);
      }(e2, "advanced_disable_flags", "advanced_disable_decide", 0, Tr);
    }
    _runBeforeSend(e2) {
      var t2;
      if (_t(this.config.before_send)) return e2;
      var i2 = Object.keys(null !== (t2 = e2.properties) && void 0 !== t2 ? t2 : {}).filter(mt), r2 = st(this.config.before_send) ? this.config.before_send : [this.config.before_send], s2 = e2;
      for (var n2 of r2) {
        if (s2 = n2(s2), _t(s2)) {
          var o2 = "Event '" + e2.event + "' was rejected in beforeSend function";
          return ft(e2.event) ? Tr.warn(o2 + ". This can cause unexpected behavior.") : Tr.info(o2), null;
        }
        s2.properties && !at(s2.properties) || Tr.warn("Event '" + e2.event + "' has no properties after beforeSend function, this is likely an error.");
      }
      for (var a2 of i2) if (s2.properties && _t(s2.properties[a2])) return Tr.warn("Event '" + e2.event + "' had its '" + a2 + "' property removed in a beforeSend function. This property is required for ingestion, so the event will be dropped."), null;
      return s2;
    }
    getPageViewId() {
      var e2;
      return null == (e2 = this.pageViewManager._currentPageview) ? void 0 : e2.pageViewId;
    }
    captureTraceFeedback(e2, t2) {
      this.capture("$ai_feedback", { $ai_trace_id: String(e2), $ai_feedback_text: t2 });
    }
    captureTraceMetric(e2, t2, i2) {
      this.capture("$ai_metric", { $ai_trace_id: String(e2), $ai_metric_name: t2, $ai_metric_value: String(i2) });
    }
    _checkLocalStorageForDebug(e2) {
      var t2 = gt(e2) && !e2, i2 = es._is_supported() && "true" === es._get("ph_debug");
      return !t2 && (!!i2 || e2);
    }
  };
  Ba.__defaultExtensionClasses = {}, Ba._noopLogger = /* @__PURE__ */ (() => {
    var e2 = () => {
    };
    return { trace: e2, debug: e2, info: e2, warn: e2, error: e2, fatal: e2 };
  })(), function(e2, t2) {
    for (var i2 = 0; t2.length > i2; i2++) e2.prototype[t2[i2]] = Or(e2.prototype[t2[i2]]);
  }(Ba, ["identify"]);
  var qa = class {
    constructor(e2) {
      this.disabled = false === e2;
      var t2 = ot(e2) ? e2 : {};
      this.thresholdPx = t2.threshold_px || 30, this.timeoutMs = t2.timeout_ms || 1e3, this.clickCount = t2.click_count || 3, this.clicks = [];
    }
    isRageClick(e2, t2, i2) {
      if (this.disabled) return false;
      var r2 = this.clicks[this.clicks.length - 1];
      if (r2 && Math.abs(e2 - r2.x) + Math.abs(t2 - r2.y) < this.thresholdPx && this.timeoutMs > i2 - r2.timestamp) {
        if (this.clicks.push({ x: e2, y: t2, timestamp: i2 }), this.clicks.length === this.clickCount) return true;
      } else this.clicks = [{ x: e2, y: t2, timestamp: i2 }];
      return false;
    }
  };
  var Ua = "$copy_autocapture";
  var Ha = Fr("[AutoCapture]");
  function za(e2, t2) {
    return t2.length > e2 ? t2.slice(0, e2) + "..." : t2;
  }
  function ja(e2) {
    if (e2.previousElementSibling) return e2.previousElementSibling;
    var t2 = e2;
    do {
      t2 = t2.previousSibling;
    } while (t2 && !hs(t2));
    return t2;
  }
  function Va(e2, t2) {
    var r2, s2, n2 = t2.e, o2 = t2.maskAllElementAttributes, a2 = t2.maskAllText, l2 = t2.elementAttributeIgnoreList, u2 = t2.elementsChainAsString, c2 = t2.disableCaptureUrlHashes;
    if (!hs(e2)) return { props: {} };
    for (var d2 = [e2], _2 = /* @__PURE__ */ new Set([e2]), h2 = e2; h2.parentNode && !ps(h2, "body") && fs > d2.length; ) if (vs(h2.parentNode)) {
      var p2 = h2.parentNode.host;
      if (_2.has(p2)) break;
      _2.add(p2), d2.push(p2), h2 = p2;
    } else {
      if (!hs(h2.parentNode)) break;
      if (_2.has(h2.parentNode)) break;
      _2.add(h2.parentNode), d2.push(h2.parentNode), h2 = h2.parentNode;
    }
    var g2, v2, f2 = [], m2 = {}, y2 = false, b2 = false;
    if (Lr(d2, (e3) => {
      var t3 = Os(e3);
      if (ps(e3, "a")) {
        var i2 = e3.getAttribute("href");
        y2 = !!(t3 && i2 && js(i2)) && (c2 ? Mi(i2) : i2);
      }
      Je(bs(e3), "ph-no-capture") && (b2 = true), f2.push(function(e4, t4, i3, r4, s3) {
        void 0 === s3 && (s3 = false);
        var n3 = e4.tagName.toLowerCase(), o3 = { tag_name: n3 };
        xs.indexOf(n3) > -1 && !i3 && (o3.$el_text = "a" === n3.toLowerCase() || "button" === n3.toLowerCase() ? za(1024, Vs(e4)) : za(1024, Ss(e4)));
        var a3 = bs(e4);
        a3.length > 0 && (o3.classes = a3.filter(function(e5) {
          return "" !== e5;
        })), Lr(e4.attributes, function(i4) {
          var n4;
          if ((!Ds(e4) || -1 !== ["name", "id", "class", "aria-label"].indexOf(i4.name)) && (null == r4 || !r4.includes(i4.name)) && !t4 && js(i4.value) && (!ut(n4 = i4.name) || "_ngcontent" !== n4.substring(0, 10) && "_nghost" !== n4.substring(0, 7))) {
            var a4 = i4.value;
            "class" === i4.name && (a4 = ms(a4).join(" ")), o3["attr__" + i4.name] = za(1024, "href" === i4.name && s3 ? Mi(a4) : a4);
          }
        });
        for (var l3 = 1, u3 = 1, c3 = e4; c3 = ja(c3); ) l3++, c3.tagName === e4.tagName && u3++;
        return o3.nth_child = l3, o3.nth_of_type = u3, o3;
      }(e3, o2, a2, l2, c2));
      var r3 = function(e4) {
        if (!Os(e4)) return {};
        var t4 = {};
        return Lr(e4.attributes, function(e5) {
          if (e5.name && 0 === e5.name.indexOf("data-ph-capture-attribute")) {
            var i3 = e5.name.replace("data-ph-capture-attribute-", ""), r4 = e5.value;
            i3 && r4 && js(r4) && (t4[i3] = r4);
          }
        }), t4;
      }(e3);
      Mr(m2, r3);
    }), b2) return { props: {}, explicitNoCapture: b2 };
    if (a2 || (f2[0].$el_text = ps(e2, "a") || ps(e2, "button") ? Vs(e2) : Ss(e2)), y2) {
      var w2, S2;
      f2[0].attr__href = y2;
      var E2 = null == (w2 = cn(y2)) ? void 0 : w2.host, x2 = null == be || null == (S2 = be.location) ? void 0 : S2.host;
      E2 && x2 && E2 !== x2 && (g2 = y2);
    }
    return { props: Mr({ $event_type: n2.type, $ce_version: 1 }, u2 ? {} : { $elements: f2 }, { $elements_chain: (v2 = f2, function(e3) {
      return e3.map((e4) => {
        var t3, r3, s3 = "";
        if (e4.tag_name && (s3 += e4.tag_name), e4.attr_class) for (var n3 of (e4.attr_class.sort(), e4.attr_class)) s3 += "." + n3.replace(/"/g, "");
        var o3 = i({}, e4.text ? { text: e4.text } : {}, { "nth-child": null !== (t3 = e4.nth_child) && void 0 !== t3 ? t3 : 0, "nth-of-type": null !== (r3 = e4.nth_of_type) && void 0 !== r3 ? r3 : 0 }, e4.href ? { href: e4.href } : {}, e4.attr_id ? { attr_id: e4.attr_id } : {}, e4.attributes), a3 = {};
        return Ar(o3).sort((e5, t4) => e5[0].localeCompare(t4[0])).forEach((e5) => {
          var t4 = e5[1];
          return a3[Gs(e5[0].toString())] = Gs(t4.toString());
        }), (s3 += ":") + Ar(a3).map((e5) => e5[0] + '="' + e5[1] + '"').join("");
      }).join(";");
    }(function(e3) {
      return e3.map((e4) => {
        var t3, i2, r3 = { text: null == (t3 = e4.$el_text) ? void 0 : t3.slice(0, 400), tag_name: e4.tag_name, href: null == (i2 = e4.attr__href) ? void 0 : i2.slice(0, 2048), attr_class: Ks(e4), attr_id: e4.attr__id, nth_child: e4.nth_child, nth_of_type: e4.nth_of_type, attributes: {} };
        return Ar(e4).filter((e5) => 0 === e5[0].indexOf("attr__")).forEach((e5) => r3.attributes[e5[0]] = e5[1]), r3;
      });
    }(v2))) }, null != (r2 = f2[0]) && r2.$el_text ? { $el_text: null == (s2 = f2[0]) ? void 0 : s2.$el_text } : {}, g2 && "click" === n2.type ? { $external_click_url: g2 } : {}, m2) };
  }
  var Wa = Fr("[ExceptionAutocapture]");
  var Ga = () => {
  };
  var Ka = Fr("[TracingHeaders]");
  var Qa = Fr("[Web Vitals]");
  var Ya = 9e5;
  var Ja = "disabled";
  var Za = "lazy_loading";
  var Xa = "awaiting_config";
  var el = "missing_config";
  Fr("[SessionRecording]"), Fr("[SessionRecording]");
  var tl = "[SessionRecording]";
  var il = Fr(tl);
  var rl = Fr("[Heatmaps]");
  function sl(e2) {
    return ot(e2) && "clientX" in e2 && "clientY" in e2 && ht(e2.clientX) && ht(e2.clientY);
  }
  var nl = Fr("[Product Tours]");
  var ol = (e2) => {
    var t2;
    return !e2.config.disable_product_tours && !(null == (t2 = e2.persistence) || !t2.get_property(y));
  };
  var al = ["$set_once", "$set"];
  var ll = Fr("[SiteApps]");
  var ul = "Error while initializing PostHog app with config id ";
  function cl(e2, t2, i2) {
    if (_t(e2)) return false;
    switch (i2) {
      case "exact":
        return e2 === t2;
      case "contains":
        var r2 = t2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, ".").replace(/%/g, ".*");
        return new RegExp(r2, "i").test(e2);
      case "regex":
        try {
          return new RegExp(t2).test(e2);
        } catch (e3) {
          return false;
        }
      default:
        return false;
    }
  }
  var dl = class {
    constructor(e2) {
      this._debugEventEmitter = new ia(), this._checkStep = (e3, t2) => this._checkStepEvent(e3, t2) && this._checkStepUrl(e3, t2) && this._checkStepElement(e3, t2) && this._checkStepProperties(e3, t2), this._checkStepEvent = (e3, t2) => null == t2 || !t2.event || (null == e3 ? void 0 : e3.event) === (null == t2 ? void 0 : t2.event), this._instance = e2, this._actionEvents = /* @__PURE__ */ new Set(), this._actionRegistry = /* @__PURE__ */ new Set();
    }
    init() {
      var e2, t2;
      lt(null == (e2 = this._instance) ? void 0 : e2._addCaptureHook) || (null == (t2 = this._instance) || t2._addCaptureHook((e3, t3) => {
        this.on(e3, t3);
      }));
    }
    register(e2) {
      var t2, i2;
      if (!lt(null == (t2 = this._instance) ? void 0 : t2._addCaptureHook) && (e2.forEach((e3) => {
        var t3, i3;
        null == (t3 = this._actionRegistry) || t3.add(e3), null == (i3 = e3.steps) || i3.forEach((e4) => {
          var t4;
          null == (t4 = this._actionEvents) || t4.add((null == e4 ? void 0 : e4.event) || "");
        });
      }), null != (i2 = this._instance) && i2.autocapture)) {
        var r2, s2 = /* @__PURE__ */ new Set();
        e2.forEach((e3) => {
          var t3;
          null == (t3 = e3.steps) || t3.forEach((e4) => {
            null != e4 && e4.selector && s2.add(null == e4 ? void 0 : e4.selector);
          });
        }), null == (r2 = this._instance) || r2.autocapture.setElementSelectors(s2);
      }
    }
    on(e2, t2) {
      var i2;
      null != t2 && 0 != e2.length && (this._actionEvents.has(e2) || this._actionEvents.has(t2.event)) && this._actionRegistry && (null == (i2 = this._actionRegistry) ? void 0 : i2.size) > 0 && this._actionRegistry.forEach((e3) => {
        this._checkAction(t2, e3) && this._debugEventEmitter.emit("actionCaptured", e3.name);
      });
    }
    _addActionHook(e2) {
      this.onAction("actionCaptured", (t2) => e2(t2));
    }
    _checkAction(e2, t2) {
      if (null == (null == t2 ? void 0 : t2.steps)) return false;
      for (var i2 of t2.steps) if (this._checkStep(e2, i2)) return true;
      return false;
    }
    onAction(e2, t2) {
      return this._debugEventEmitter.on(e2, t2);
    }
    _checkStepUrl(e2, t2) {
      if (null != t2 && t2.url) {
        var i2, r2 = null == e2 || null == (i2 = e2.properties) ? void 0 : i2.$current_url;
        if (!r2 || "string" != typeof r2) return false;
        if (!cl(r2, t2.url, t2.url_matching || "contains")) return false;
      }
      return true;
    }
    _checkStepElement(e2, t2) {
      return !!this._checkStepHref(e2, t2) && !!this._checkStepText(e2, t2) && !!this._checkStepSelector(e2, t2);
    }
    _checkStepHref(e2, t2) {
      var i2;
      if (null == t2 || !t2.href) return true;
      var r2 = this._getElementsList(e2);
      if (r2.length > 0) return r2.some((e3) => cl(e3.href, t2.href, t2.href_matching || "exact"));
      var s2, n2 = (null == e2 || null == (i2 = e2.properties) ? void 0 : i2.$elements_chain) || "";
      return !!n2 && cl((s2 = n2.match(/(?::|")href="(.*?)"/)) ? s2[1] : "", t2.href, t2.href_matching || "exact");
    }
    _checkStepText(e2, t2) {
      var i2;
      if (null == t2 || !t2.text) return true;
      var r2 = this._getElementsList(e2);
      if (r2.length > 0) return r2.some((e3) => cl(e3.text, t2.text, t2.text_matching || "exact") || cl(e3.$el_text, t2.text, t2.text_matching || "exact"));
      var s2, n2, o2, a2 = (null == e2 || null == (i2 = e2.properties) ? void 0 : i2.$elements_chain) || "";
      return !!a2 && (s2 = function(e3) {
        for (var t3, i3 = [], r3 = /(?::|")text="(.*?)"/g; !_t(t3 = r3.exec(e3)); ) i3.includes(t3[1]) || i3.push(t3[1]);
        return i3;
      }(a2), n2 = t2.text, o2 = t2.text_matching || "exact", s2.some((e3) => cl(e3, n2, o2)));
    }
    _checkStepSelector(e2, t2) {
      var i2, r2;
      if (null == t2 || !t2.selector) return true;
      var s2 = null == e2 || null == (i2 = e2.properties) ? void 0 : i2.$element_selectors;
      if (null != s2 && s2.includes(t2.selector)) return true;
      var n2 = (null == e2 || null == (r2 = e2.properties) ? void 0 : r2.$elements_chain) || "";
      if (t2.selector_regex && n2) try {
        return new RegExp(t2.selector_regex).test(n2);
      } catch (e3) {
        return false;
      }
      return false;
    }
    _getElementsList(e2) {
      var t2;
      return null == (null == e2 || null == (t2 = e2.properties) ? void 0 : t2.$elements) ? [] : null == e2 ? void 0 : e2.properties.$elements;
    }
    _checkStepProperties(e2, t2) {
      return null == t2 || !t2.properties || 0 === t2.properties.length || da(t2.properties.reduce((e3, t3) => {
        var i2 = st(t3.value) ? t3.value.map(String) : null != t3.value ? [String(t3.value)] : [];
        return e3[t3.key] = { values: i2, operator: t3.operator || "exact" }, e3;
      }, {}), null == e2 ? void 0 : e2.properties);
    }
  };
  var _l = class {
    constructor(e2) {
      var t2;
      this._pendingActivatedItems = [], this._instance = e2, this._eventToItems = /* @__PURE__ */ new Map(), this._cancelEventToItems = /* @__PURE__ */ new Map(), this._actionToItems = /* @__PURE__ */ new Map(), null == (t2 = this._instance) || null == t2.onSessionId || t2.onSessionId((e3) => this._onSessionIdChanged(e3));
    }
    _doesEventMatchFilter(e2, t2) {
      return !!e2 && da(e2.propertyFilters, null == t2 ? void 0 : t2.properties);
    }
    _buildEventToItemMap(e2, t2) {
      var i2 = /* @__PURE__ */ new Map();
      return e2.forEach((e3) => {
        var r2;
        null == (r2 = e3.conditions) || null == (r2 = r2[t2]) || null == (r2 = r2.values) || r2.forEach((t3) => {
          if (null != t3 && t3.name) {
            var r3 = i2.get(t3.name) || [];
            r3.push(e3.id), i2.set(t3.name, r3);
          }
        });
      }), i2;
    }
    _getMatchingItems(e2, t2, i2) {
      var r2 = (i2 === $n.Activation ? this._eventToItems : this._cancelEventToItems).get(e2), s2 = [];
      return this._getItems((e3) => {
        s2 = e3.filter((e4) => null == r2 ? void 0 : r2.includes(e4.id));
      }), s2.filter((r3) => {
        var s3, n2 = null == (s3 = r3.conditions) || null == (s3 = s3[i2]) || null == (s3 = s3.values) ? void 0 : s3.find((t3) => t3.name === e2);
        return this._doesEventMatchFilter(n2, t2);
      });
    }
    register(e2) {
      var t2;
      lt(null == (t2 = this._instance) ? void 0 : t2._addCaptureHook) || (this._setupEventBasedItems(e2), this._setupActionBasedItems(e2));
    }
    _setupActionBasedItems(e2) {
      var t2 = e2.filter((e3) => {
        var t3, i2;
        return (null == (t3 = e3.conditions) ? void 0 : t3.actions) && (null == (i2 = e3.conditions) || null == (i2 = i2.actions) || null == (i2 = i2.values) ? void 0 : i2.length) > 0;
      });
      0 !== t2.length && (null == this._actionMatcher && (this._actionMatcher = new dl(this._instance), this._actionMatcher.init(), this._actionMatcher._addActionHook((e3) => {
        this.onAction(e3);
      })), t2.forEach((e3) => {
        var t3, i2, r2, s2, n2;
        e3.conditions && null != (t3 = e3.conditions) && t3.actions && null != (i2 = e3.conditions) && null != (i2 = i2.actions) && i2.values && (null == (r2 = e3.conditions) || null == (r2 = r2.actions) || null == (r2 = r2.values) ? void 0 : r2.length) > 0 && (null == (s2 = this._actionMatcher) || s2.register(e3.conditions.actions.values), null == (n2 = e3.conditions) || null == (n2 = n2.actions) || null == (n2 = n2.values) || n2.forEach((t4) => {
          if (t4 && t4.name) {
            var i3 = this._actionToItems.get(t4.name);
            i3 && i3.push(e3.id), this._actionToItems.set(t4.name, i3 || [e3.id]);
          }
        }));
      }));
    }
    _setupEventBasedItems(e2) {
      var t2, i2 = e2.filter((e3) => {
        var t3, i3;
        return (null == (t3 = e3.conditions) ? void 0 : t3.events) && (null == (i3 = e3.conditions) || null == (i3 = i3.events) || null == (i3 = i3.values) ? void 0 : i3.length) > 0;
      }), r2 = e2.filter((e3) => {
        var t3, i3;
        return (null == (t3 = e3.conditions) ? void 0 : t3.cancelEvents) && (null == (i3 = e3.conditions) || null == (i3 = i3.cancelEvents) || null == (i3 = i3.values) ? void 0 : i3.length) > 0;
      });
      0 === i2.length && 0 === r2.length || (null == (t2 = this._instance) || t2._addCaptureHook((e3, t3) => {
        this.onEvent(e3, t3);
      }), this._eventToItems = this._buildEventToItemMap(e2, $n.Activation), this._cancelEventToItems = this._buildEventToItemMap(e2, $n.Cancellation));
    }
    onEvent(e2, t2) {
      var i2, r2, s2 = this._getLogger(), n2 = (null == t2 || null == (i2 = t2.properties) ? void 0 : i2.$survey_id) || (null == t2 || null == (r2 = t2.properties) ? void 0 : r2.$product_tour_id);
      if (n2 && this.getActivatedIds().includes(n2)) {
        var o2 = this._activationOutcome(e2, n2);
        if ("consume" === o2) return s2.info("event consumed activated item, removing it", { event: e2, itemId: n2 }), void this._deactivateItems([n2]);
        if ("persist" === o2) return s2.info("shown item promoted to persisted activation", { event: e2, itemId: n2 }), void this._persistActivation(n2);
      }
      if (this._cancelEventToItems.has(e2)) {
        var a2 = this._getMatchingItems(e2, t2, $n.Cancellation);
        a2.length > 0 && (s2.info("cancel event matched, cancelling items", { event: e2, itemsToCancel: a2.map((e3) => e3.id) }), this._deactivateItems(a2.map((e3) => e3.id)), a2.forEach((e3) => this._cancelPendingItem(e3.id)));
      }
      if (this._eventToItems.has(e2)) {
        s2.info("event name matched", { event: e2, eventPayload: t2, items: this._eventToItems.get(e2) });
        var l2 = this._getMatchingItems(e2, t2, $n.Activation);
        this._activateItems(l2.map((e3) => e3.id));
      }
    }
    onAction(e2) {
      this._actionToItems.has(e2) && this._activateItems(this._actionToItems.get(e2) || []);
    }
    _activateItems(e2) {
      0 !== e2.length && (this._pendingActivatedItems = [.../* @__PURE__ */ new Set([...this._pendingActivatedItems, ...e2])], this._getLogger().info("updating activated items", { activatedItems: this.getActivatedIds() }));
    }
    _persistActivation(e2) {
      this._pendingActivatedItems = this._pendingActivatedItems.filter((t3) => t3 !== e2);
      var t2 = this._getPersistedActivatedIds();
      t2.includes(e2) || (this._setActivatedItems([...t2, e2]), this._stampActivationSession());
    }
    _deactivateItems(e2) {
      var t2 = new Set(e2);
      this._pendingActivatedItems = this._pendingActivatedItems.filter((e3) => !t2.has(e3));
      var i2 = this._getRawPersistedActivatedIds(), r2 = i2.filter((e3) => !t2.has(e3));
      r2.length !== i2.length && (this._setActivatedItems(r2), 0 === r2.length && this._clearActivationSession());
    }
    _getRawPersistedActivatedIds() {
      var e2, t2 = this._getActivatedKey();
      return (null == (e2 = this._instance) || null == (e2 = e2.persistence) ? void 0 : e2.props[t2]) || [];
    }
    _getPersistedActivatedIds() {
      var e2, t2, i2 = this._getRawPersistedActivatedIds();
      if (0 === i2.length) return [];
      var r2 = null == (e2 = this._instance) || null == (e2 = e2.persistence) ? void 0 : e2.props[this._getActivatedSessionKey()], s2 = null == (t2 = this._instance) || null == t2.get_session_id ? void 0 : t2.get_session_id();
      return s2 && r2 === s2 ? i2 : [];
    }
    _stampActivationSession() {
      var e2, t2 = null == (e2 = this._instance) || null == e2.get_session_id ? void 0 : e2.get_session_id();
      t2 && this._setActivatedSession(t2);
    }
    _clearActivationSession() {
      this._clearActivatedSession();
    }
    _onSessionIdChanged(e2) {
      var t2, i2 = null == (t2 = this._instance) || null == (t2 = t2.persistence) ? void 0 : t2.props[this._getActivatedSessionKey()];
      i2 && i2 !== e2 && (this._getRawPersistedActivatedIds().length > 0 && this._setActivatedItems([]), this._clearActivationSession());
    }
    getActivatedIds() {
      return [.../* @__PURE__ */ new Set([...this._getPersistedActivatedIds(), ...this._pendingActivatedItems])].filter((e2) => !this._isItemPermanentlyIneligible(e2));
    }
    reset() {
      this._pendingActivatedItems = [], this._getRawPersistedActivatedIds().length > 0 && this._setActivatedItems([]), this._clearActivationSession();
    }
    getEventToItemsMap() {
      return this._eventToItems;
    }
    _getActionMatcher() {
      return this._actionMatcher;
    }
  };
  var hl = class extends _l {
    constructor(e2) {
      super(e2);
    }
    _getActivatedKey() {
      return z;
    }
    _getActivatedSessionKey() {
      return j;
    }
    _getShownEventName() {
      return zn.SHOWN;
    }
    _getItems(e2) {
      var t2;
      null == (t2 = this._instance) || t2.getSurveys(e2);
    }
    _cancelPendingItem(e2) {
      var t2;
      null == (t2 = this._instance) || t2.cancelPendingSurvey(e2);
    }
    _getLogger() {
      return fa;
    }
    _setActivatedItems(e2) {
      var t2;
      null == (t2 = this._instance) || null == (t2 = t2.persistence) || t2.register({ [z]: e2 });
    }
    _setActivatedSession(e2) {
      var t2;
      null == (t2 = this._instance) || null == (t2 = t2.persistence) || t2.register({ [j]: e2 });
    }
    _clearActivatedSession() {
      var e2;
      null == (e2 = this._instance) || null == (e2 = e2.persistence) || e2.unregister(j);
    }
    _isItemPermanentlyIneligible() {
      return false;
    }
    _activationOutcome(e2, t2) {
      var i2;
      this._getItems((e3) => {
        i2 = e3.find((e4) => e4.id === t2);
      });
      var r2 = !i2 || function(e3) {
        var t3;
        return va(e3) && !(null == (t3 = e3.conditions) || null == (t3 = t3.events) || !t3.repeatedActivation) || "always" === e3.schedule;
      }(i2);
      return r2 ? e2 === zn.SHOWN ? "consume" : "ignore" : e2 === zn.SHOWN ? "persist" : e2 === zn.DISMISSED || e2 === zn.SENT ? "consume" : "ignore";
    }
    getSurveys() {
      return this.getActivatedIds();
    }
    getEventToSurveys() {
      return this.getEventToItemsMap();
    }
  };
  var pl = "SDK is not enabled or survey functionality is not yet loaded";
  var gl = "Disabled. Not loading surveys.";
  var vl = null != be && be.location ? hn(be.location.hash, "__posthog") || hn(location.hash, "state") : null;
  var fl = "_postHogToolbarParams";
  var ml = Fr("[Toolbar]");
  var yl = Fr("[FeatureFlags]");
  var bl = Fr("[FeatureFlags]", { debugEnabled: true });
  var wl = `" failed. Feature flags didn't load in time.`;
  var Sl = (e2) => {
    for (var t2 = {}, i2 = 0; e2.length > i2; i2++) t2[e2[i2]] = true;
    return t2;
  };
  var El = (e2) => {
    var t2 = {};
    for (var i2 of Ar(e2 || {})) {
      var r2 = i2[1];
      r2 && (t2[i2[0]] = r2);
    }
    return t2;
  };
  var xl = Fr("[Error tracking]");
  var kl = "Refusing to render web experiment since the viewer is a likely bot";
  var Pl = { icontains: (e2, t2) => t2.toLowerCase().indexOf(e2.toLowerCase()) > -1, not_icontains: (e2, t2) => -1 === t2.toLowerCase().indexOf(e2.toLowerCase()), regex: (e2, t2) => aa(t2, e2), not_regex: (e2, t2) => !aa(t2, e2), exact: (e2, t2) => t2 === e2, is_not: (e2, t2) => t2 !== e2 };
  var Il = class _Il {
    get _config() {
      return this._instance.config;
    }
    constructor(e2) {
      var t2 = this;
      this.getWebExperimentsAndEvaluateDisplayLogic = function(e3) {
        void 0 === e3 && (e3 = false), t2.getWebExperiments((e4) => {
          _Il._logInfo("retrieved web experiments from the server"), t2._flagToExperiments = /* @__PURE__ */ new Map(), e4.forEach((e5) => {
            if (e5.feature_flag_key) {
              var i2;
              t2._flagToExperiments && (_Il._logInfo("setting flag key ", e5.feature_flag_key, " to web experiment ", e5), null == (i2 = t2._flagToExperiments) || i2.set(e5.feature_flag_key, e5));
              var r2 = t2._instance.getFeatureFlag(e5.feature_flag_key);
              ut(r2) && e5.variants[r2] && t2._applyTransforms(e5.name, r2, e5.variants[r2].transforms);
            } else if (e5.variants) for (var s2 in e5.variants) {
              var n2 = e5.variants[s2];
              _Il._matchesTestVariant(n2, t2._instance) && t2._applyTransforms(e5.name, s2, n2.transforms);
            }
          });
        }, e3);
      }, this._instance = e2, this._instance.onFeatureFlags((e3) => {
        this.onFeatureFlags(e3);
      });
    }
    initialize() {
    }
    onFeatureFlags(e2) {
      if (this._is_bot()) _Il._logInfo(kl);
      else if (!this._config.disable_web_experiments) {
        if (_t(this._flagToExperiments)) return this._flagToExperiments = /* @__PURE__ */ new Map(), this.loadIfEnabled(), void this.previewWebExperiment();
        _Il._logInfo("applying feature flags", e2), e2.forEach((e3) => {
          var t2;
          if (this._flagToExperiments && null != (t2 = this._flagToExperiments) && t2.has(e3)) {
            var i2, r2 = this._instance.getFeatureFlag(e3), s2 = null == (i2 = this._flagToExperiments) ? void 0 : i2.get(e3);
            r2 && null != s2 && s2.variants[r2] && this._applyTransforms(s2.name, r2, s2.variants[r2].transforms);
          }
        });
      }
    }
    previewWebExperiment() {
      var e2 = _Il.getWindowLocation();
      if (null != e2 && e2.search) {
        var t2 = dn(null == e2 ? void 0 : e2.search, "__experiment_id"), i2 = dn(null == e2 ? void 0 : e2.search, "__experiment_variant");
        t2 && i2 && (_Il._logInfo("previewing web experiments " + t2 + " && " + i2), this.getWebExperiments((e3) => {
          this._showPreviewWebExperiment(parseInt(t2), i2, e3);
        }, false, true));
      }
    }
    loadIfEnabled() {
      this._config.disable_web_experiments || this.getWebExperimentsAndEvaluateDisplayLogic();
    }
    getWebExperiments(e2, t2, i2) {
      if (this._config.disable_web_experiments && !i2) return e2([]);
      var r2 = this._instance.get_property("$web_experiments");
      if (r2 && !t2) return e2(r2);
      this._instance._send_request({ url: this._instance.requestRouter.endpointFor("api", "/api/web_experiments/?token=" + this._config.token), method: "GET", timestampMode: "query", callback: (t3) => e2(200 === t3.statusCode && t3.json && t3.json.experiments || []) });
    }
    _showPreviewWebExperiment(e2, t2, i2) {
      var r2 = i2.filter((t3) => t3.id === e2);
      r2 && r2.length > 0 && (_Il._logInfo("Previewing web experiment [" + r2[0].name + "] with variant [" + t2 + "]"), this._applyTransforms(r2[0].name, t2, r2[0].variants[t2].transforms));
    }
    static _matchesTestVariant(e2, t2) {
      return !_t(e2.conditions) && _Il._matchUrlConditions(e2, t2) && _Il._matchUTMConditions(e2);
    }
    static _matchUrlConditions(e2, t2) {
      var i2;
      if (_t(e2.conditions) || _t(null == (i2 = e2.conditions) ? void 0 : i2.url)) return true;
      var r2 = _Il.getWindowLocation();
      if (r2) {
        var s2, n2, o2, a2 = as(t2, r2.href);
        return null == (s2 = e2.conditions) || !s2.url || Pl[null !== (n2 = null == (o2 = e2.conditions) ? void 0 : o2.urlMatchType) && void 0 !== n2 ? n2 : "icontains"](e2.conditions.url, a2);
      }
      return false;
    }
    static getWindowLocation() {
      return null == be ? void 0 : be.location;
    }
    static _matchUTMConditions(e2) {
      var t2;
      if (_t(e2.conditions) || _t(null == (t2 = e2.conditions) ? void 0 : t2.utm)) return true;
      var i2 = wn();
      if (i2.utm_source) {
        var r2, s2, n2, o2, a2, l2, u2, c2, d2 = null == (r2 = e2.conditions) || null == (r2 = r2.utm) || !r2.utm_campaign || (null == (s2 = e2.conditions) || null == (s2 = s2.utm) ? void 0 : s2.utm_campaign) == i2.utm_campaign, _2 = null == (n2 = e2.conditions) || null == (n2 = n2.utm) || !n2.utm_source || (null == (o2 = e2.conditions) || null == (o2 = o2.utm) ? void 0 : o2.utm_source) == i2.utm_source, h2 = null == (a2 = e2.conditions) || null == (a2 = a2.utm) || !a2.utm_medium || (null == (l2 = e2.conditions) || null == (l2 = l2.utm) ? void 0 : l2.utm_medium) == i2.utm_medium, p2 = null == (u2 = e2.conditions) || null == (u2 = u2.utm) || !u2.utm_term || (null == (c2 = e2.conditions) || null == (c2 = c2.utm) ? void 0 : c2.utm_term) == i2.utm_term;
        return d2 && h2 && p2 && _2;
      }
      return false;
    }
    static _logInfo(e2) {
      for (var t2 = arguments.length, i2 = new Array(t2 > 1 ? t2 - 1 : 0), r2 = 1; t2 > r2; r2++) i2[r2 - 1] = arguments[r2];
      Tr.info("[WebExperiments] " + e2, i2);
    }
    _applyTransforms(e2, t2, i2) {
      this._is_bot() ? _Il._logInfo(kl) : "control" !== t2 ? i2.forEach((i3) => {
        if (i3.selector) {
          var r2;
          _Il._logInfo("applying transform of variant " + t2 + " for experiment " + e2 + " ", i3);
          var s2 = null == (r2 = document) ? void 0 : r2.querySelectorAll(i3.selector);
          null == s2 || s2.forEach((e3) => {
            var t3 = e3;
            i3.html && (t3.innerHTML = i3.html), i3.css && t3.setAttribute("style", i3.css);
          });
        }
      }) : _Il._logInfo("Control variants leave the page unmodified.");
    }
    _is_bot() {
      return Se && this._instance ? na(Se, this._config.custom_blocked_useragents) : void 0;
    }
  };
  var Cl = Fr("[Conversations]");
  var Tl = "Conversations not available yet.";
  var Fl = "console";
  var Rl = { featureFlags: class {
    constructor(e2) {
      this._override_warning = false, this._hasLoadedFlags = false, this._requestInFlight = false, this._reloadingDisabled = false, this._additionalReloadRequested = false, this._flagsLoadedFromRemote = false, this._hasLoggedDeprecationWarning = false, this._staleCacheRefreshTriggered = false, this._consecutiveStatusZeroFailures = 0, this._onOnline = () => {
        var e3 = this._hasStatusZeroCircuitBreakerTripped();
        this._consecutiveStatusZeroFailures = 0, e3 && this.reloadFeatureFlags();
      }, this._instance = e2, this.featureFlagEventHandlers = [], be && qr(be, "online", this._onOnline);
    }
    destroy() {
      null == be || be.removeEventListener("online", this._onOnline);
    }
    get _config() {
      return this._instance.config;
    }
    get _persistence() {
      return this._instance.persistence;
    }
    _prop(e2) {
      return this._instance.get_property(e2);
    }
    _isCacheStale() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this._persistence) ? void 0 : t2._isFeatureFlagCacheStale(this._config.feature_flag_cache_ttl_ms)) && void 0 !== e2 && e2;
    }
    _checkAndTriggerStaleRefresh() {
      return !!this._isCacheStale() && (this._staleCacheRefreshTriggered || this._requestInFlight || (this._staleCacheRefreshTriggered = true, yl.warn("Feature flag cache is stale, triggering refresh..."), this.reloadFeatureFlags()), true);
    }
    _getValidEvaluationEnvironments() {
      var e2, t2 = null !== (e2 = this._config.evaluation_contexts) && void 0 !== e2 ? e2 : this._config.evaluation_environments;
      return !this._config.evaluation_environments || this._config.evaluation_contexts || this._hasLoggedDeprecationWarning || (yl.warn("evaluation_environments is deprecated. Use evaluation_contexts instead. evaluation_environments will be removed in a future version."), this._hasLoggedDeprecationWarning = true), null != t2 && t2.length ? t2.filter((e3) => {
        var t3 = e3 && "string" == typeof e3 && e3.trim().length > 0;
        return t3 || yl.error("Invalid evaluation context found:", e3, "Expected non-empty string"), t3;
      }) : [];
    }
    _shouldIncludeEvaluationEnvironments() {
      return this._getValidEvaluationEnvironments().length > 0;
    }
    _getValidFlagKeys() {
      var e2 = this._config.flag_keys;
      if (!lt(e2)) {
        if (st(e2)) return e2.filter((e3) => {
          var t2 = e3 && "string" == typeof e3 && e3.trim().length > 0;
          return t2 || yl.error("Invalid flag key found:", e3, "Expected non-empty string"), t2;
        });
        yl.error("Invalid flag_keys found:", e2, "Expected array of non-empty strings");
      }
    }
    initialize() {
      var e2, t2, i2 = this._instance.config, r2 = null !== (e2 = null == (t2 = i2.bootstrap) ? void 0 : t2.featureFlags) && void 0 !== e2 ? e2 : {};
      if (Object.keys(r2).length) {
        var s2, n2, o2 = null !== (s2 = null == (n2 = i2.bootstrap) ? void 0 : n2.featureFlagPayloads) && void 0 !== s2 ? s2 : {}, a2 = Object.keys(r2).filter((e3) => !!r2[e3]).reduce((e3, t3) => (e3[t3] = r2[t3] || false, e3), {}), l2 = Object.keys(o2).filter((e3) => a2[e3]).reduce((e3, t3) => (o2[t3] && (e3[t3] = o2[t3]), e3), {});
        this.receivedFeatureFlags({ featureFlags: a2, featureFlagPayloads: l2 });
      }
    }
    updateFlags(e2, t2, r2) {
      var s2, n2, o2 = null != r2 && r2.merge && null !== (s2 = this._prop(T)) && void 0 !== s2 ? s2 : {}, a2 = null != r2 && r2.merge && null !== (n2 = this._prop(M)) && void 0 !== n2 ? n2 : {}, l2 = i({}, o2, e2), u2 = i({}, a2, t2), c2 = {};
      for (var d2 of Object.entries(l2)) {
        var _2 = d2[0], h2 = d2[1];
        c2[_2] = { key: _2, enabled: Ae(h2), variant: $e(h2), reason: void 0, metadata: lt(null == u2 ? void 0 : u2[_2]) ? void 0 : { id: 0, version: void 0, description: void 0, payload: u2[_2] } };
      }
      this.receivedFeatureFlags({ flags: c2 });
    }
    get hasLoadedFlags() {
      return this._hasLoadedFlags;
    }
    getFlags() {
      return Object.keys(this.getFlagVariants());
    }
    getFlagsWithDetails() {
      var e2 = this._prop(L), t2 = this._prop(D), r2 = this._prop(N);
      if (!r2 && !t2) return e2 || {};
      var s2 = Mr({}, e2 || {}), n2 = [.../* @__PURE__ */ new Set([...Object.keys(r2 || {}), ...Object.keys(t2 || {})])];
      for (var o2 of n2) {
        var a2, l2, u2 = s2[o2], c2 = null == t2 ? void 0 : t2[o2], d2 = lt(c2) ? null !== (a2 = null == u2 ? void 0 : u2.enabled) && void 0 !== a2 && a2 : !!c2, _2 = lt(c2) ? u2.variant : "string" == typeof c2 ? c2 : void 0, h2 = null == r2 ? void 0 : r2[o2], p2 = i({}, u2, { enabled: d2, variant: d2 ? null != _2 ? _2 : null == u2 ? void 0 : u2.variant : void 0 });
        d2 !== (null == u2 ? void 0 : u2.enabled) && (p2.original_enabled = null == u2 ? void 0 : u2.enabled), _2 !== (null == u2 ? void 0 : u2.variant) && (p2.original_variant = null == u2 ? void 0 : u2.variant), h2 && (p2.metadata = i({}, null == u2 ? void 0 : u2.metadata, { payload: h2, original_payload: null == u2 || null == (l2 = u2.metadata) ? void 0 : l2.payload })), s2[o2] = p2;
      }
      return this._override_warning || (yl.warn(" Overriding feature flag details!", { flagDetails: e2, overriddenPayloads: r2, finalDetails: s2 }), this._override_warning = true), s2;
    }
    getAllFeatureFlags() {
      var e2 = this.getFlagVariants(), t2 = this.getFlagPayloads();
      return Object.keys(e2).map((i2) => {
        var r2 = e2[i2];
        return { key: i2, enabled: Ae(r2), variant: $e(r2), payload: Me(t2[i2]) };
      });
    }
    getFlagVariants() {
      var e2 = this._prop(T), t2 = this._prop(D);
      if (!t2) return e2 || {};
      for (var i2 = Mr({}, e2), r2 = Object.keys(t2), s2 = 0; r2.length > s2; s2++) i2[r2[s2]] = t2[r2[s2]];
      return this._override_warning || (yl.warn(" Overriding feature flags!", { enabledFlags: e2, overriddenFlags: t2, finalFlags: i2 }), this._override_warning = true), i2;
    }
    getFlagPayloads() {
      var e2 = this._prop(M), t2 = this._prop(N);
      if (!t2) return e2 || {};
      for (var i2 = Mr({}, e2 || {}), r2 = Object.keys(t2), s2 = 0; r2.length > s2; s2++) i2[r2[s2]] = t2[r2[s2]];
      return this._override_warning || (yl.warn(" Overriding feature flag payloads!", { flagPayloads: e2, overriddenPayloads: t2, finalPayloads: i2 }), this._override_warning = true), i2;
    }
    reloadFeatureFlags() {
      this._reloadingDisabled || this._config.advanced_disable_feature_flags || this._hasStatusZeroCircuitBreakerTripped() || this._reloadDebouncer || (this._instance._internalEventEmitter.emit("featureFlagsReloading", true), this._reloadDebouncer = setTimeout(() => {
        this._callFlagsEndpoint();
      }, 5));
    }
    _clearDebouncer() {
      clearTimeout(this._reloadDebouncer), this._reloadDebouncer = void 0;
    }
    ensureFlagsLoaded() {
      this._hasLoadedFlags || this._requestInFlight || this._reloadDebouncer || this.reloadFeatureFlags();
    }
    setAnonymousDistinctId(e2) {
      this.$anon_distinct_id = e2;
    }
    setReloadingPaused(e2) {
      this._reloadingDisabled = e2;
    }
    _callFlagsEndpoint(e2) {
      var t2;
      if (this._clearDebouncer(), !this._instance._shouldDisableFlags() && !this._hasStatusZeroCircuitBreakerTripped()) if (this._requestInFlight) this._additionalReloadRequested = true;
      else {
        var r2 = this._config.token, s2 = this._prop(l), n2 = { token: r2, distinct_id: this._instance.get_distinct_id(), groups: this._instance.getGroups(), $anon_distinct_id: this.$anon_distinct_id, person_properties: i({}, (null == (t2 = this._persistence) ? void 0 : t2.get_initial_props()) || {}, this._prop(B) || {}), group_properties: this._prop(q), timezone: Tn() };
        dt(s2) || lt(s2) || (n2.$device_id = s2), (null != e2 && e2.disableFlags || this._config.advanced_disable_feature_flags) && (n2.disable_flags = true), this._shouldIncludeEvaluationEnvironments() && (n2.evaluation_contexts = this._getValidEvaluationEnvironments());
        var o2 = this._getValidFlagKeys();
        lt(o2) || (n2.flag_keys = o2);
        var a2 = !!this._config.advanced_only_evaluate_survey_feature_flags, u2 = this._instance.requestRouter.endpointFor("flags", "/flags/?v=2" + (this._config.advanced_only_evaluate_survey_feature_flags ? "&only_evaluate_survey_feature_flags=true" : ""));
        this._requestInFlight = true, this._instance._send_request({ method: "POST", url: u2, data: n2, compression: this._config.disable_compression ? void 0 : eo.Base64, timestampMode: "body", timeout: this._config.feature_flag_request_timeout_ms, callback: (e3) => {
          var t3, i2, r3, s3 = true;
          if (this._trackStatusZeroReachability(e3.statusCode), 200 === e3.statusCode && (this._additionalReloadRequested || (this.$anon_distinct_id = void 0), s3 = false), this._requestInFlight = false, !n2.disable_flags || this._additionalReloadRequested) {
            this._flagsLoadedFromRemote = !s3;
            var o3 = [];
            e3.error ? e3.error instanceof Error ? o3.push("AbortError" === e3.error.name ? "timeout" : "connection_error") : o3.push("unknown_error") : 200 !== e3.statusCode && o3.push("api_error_" + e3.statusCode), null != (t3 = e3.json) && t3.errorsWhileComputingFlags && o3.push("errors_while_computing_flags");
            var l2, u3 = !(null == (i2 = e3.json) || null == (i2 = i2.quotaLimited) || !i2.includes("feature_flags"));
            if (u3 && o3.push("quota_limited"), null == (r3 = this._persistence) || r3.register({ [K]: o3 }), u3) yl.warn("You have hit your feature flags quota limit, and will not be able to load feature flags until the quota is reset.  Please visit https://posthog.com/docs/billing/limits-alerts to learn more.");
            else n2.disable_flags || this.receivedFeatureFlags(null !== (l2 = e3.json) && void 0 !== l2 ? l2 : {}, s3, { partialResponse: a2 }), this._additionalReloadRequested && (this._additionalReloadRequested = false, this._callFlagsEndpoint());
          }
        } });
      }
    }
    _hasStatusZeroCircuitBreakerTripped() {
      return pn(this._consecutiveStatusZeroFailures, 3);
    }
    _trackStatusZeroReachability(e2) {
      this._consecutiveStatusZeroFailures = gn(e2, this._consecutiveStatusZeroFailures, 3, () => yl.warn("Feature flag requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped refreshing feature flags; will try again when connectivity changes."));
    }
    getFeatureFlag(e2, t2) {
      var i2;
      if (void 0 === t2 && (t2 = {}), !t2.fresh || this._flagsLoadedFromRemote) if (this._hasLoadedFlags || this.getFlags() && this.getFlags().length > 0) {
        if (!this._checkAndTriggerStaleRefresh()) {
          var r2 = this.getFeatureFlagResult(e2, t2);
          return null !== (i2 = null == r2 ? void 0 : r2.variant) && void 0 !== i2 ? i2 : null == r2 ? void 0 : r2.enabled;
        }
      } else yl.warn('getFeatureFlag for key "' + e2 + wl);
    }
    getFeatureFlagDetails(e2) {
      return this.getFlagsWithDetails()[e2];
    }
    getFeatureFlagPayload(e2) {
      var t2 = this.getFeatureFlagResult(e2, { send_event: false });
      return null == t2 ? void 0 : t2.payload;
    }
    getFeatureFlagResult(e2, t2) {
      if (void 0 === t2 && (t2 = {}), !t2.fresh || this._flagsLoadedFromRemote) if (this._hasLoadedFlags || this.getFlags() && this.getFlags().length > 0) {
        if (!this._checkAndTriggerStaleRefresh()) {
          var i2 = this.getFlagVariants(), r2 = e2 in i2, s2 = i2[e2], n2 = this.getFlagPayloads()[e2], o2 = String(s2), a2 = this._prop(A) || void 0, l2 = this._prop(Q) || void 0, u2 = this._prop(W) || {};
          if (this._config.advanced_feature_flags_dedup_per_session) {
            var c2, d2 = this._instance.get_session_id(), _2 = this._prop(G);
            d2 && d2 !== _2 && (u2 = {}, null == (c2 = this._persistence) || c2.register({ [W]: u2, [G]: d2 }));
          }
          if ((t2.send_event || !("send_event" in t2)) && (!(e2 in u2) || !u2[e2].includes(o2))) {
            var h2, p2, g2, v2, f2, m2, y2, b2, w2, S2, E2;
            st(u2[e2]) ? u2[e2].push(o2) : u2[e2] = [o2], null == (h2 = this._persistence) || h2.register({ [W]: u2 });
            var x2 = this.getFeatureFlagDetails(e2), k2 = [...null !== (p2 = this._prop(K)) && void 0 !== p2 ? p2 : []];
            lt(s2) && k2.push("flag_missing");
            var P2 = { $feature_flag: e2, $feature_flag_response: s2, $feature_flag_payload: n2 || null, $feature_flag_request_id: a2, $feature_flag_evaluated_at: l2, $feature_flag_bootstrapped_response: (null == (g2 = this._config.bootstrap) || null == (g2 = g2.featureFlags) ? void 0 : g2[e2]) || null, $feature_flag_bootstrapped_payload: (null == (v2 = this._config.bootstrap) || null == (v2 = v2.featureFlagPayloads) ? void 0 : v2[e2]) || null, $used_bootstrap_value: !this._flagsLoadedFromRemote };
            lt(null == x2 || null == (f2 = x2.metadata) ? void 0 : f2.has_experiment) || (P2.$feature_flag_has_experiment = x2.metadata.has_experiment), lt(null == x2 || null == (m2 = x2.metadata) ? void 0 : m2.version) || (P2.$feature_flag_version = x2.metadata.version);
            var I2, C2 = null !== (y2 = null == x2 || null == (b2 = x2.reason) ? void 0 : b2.description) && void 0 !== y2 ? y2 : null == x2 || null == (w2 = x2.reason) ? void 0 : w2.code;
            C2 && (P2.$feature_flag_reason = C2), null != x2 && null != (S2 = x2.metadata) && S2.id && (P2.$feature_flag_id = x2.metadata.id), lt(null == x2 ? void 0 : x2.original_variant) && lt(null == x2 ? void 0 : x2.original_enabled) || (P2.$feature_flag_original_response = lt(x2.original_variant) ? x2.original_enabled : x2.original_variant), null != x2 && null != (E2 = x2.metadata) && E2.original_payload && (P2.$feature_flag_original_payload = null == x2 || null == (I2 = x2.metadata) ? void 0 : I2.original_payload), k2.length && (P2.$feature_flag_error = k2.join(",")), this._instance.capture("$feature_flag_called", P2);
          }
          if (r2) return { key: e2, enabled: !!s2, variant: "string" == typeof s2 ? s2 : void 0, payload: Me(n2) };
        }
      } else yl.warn('getFeatureFlagResult for key "' + e2 + wl);
    }
    getRemoteConfigPayload(e2, t2) {
      var i2 = this._config.token, r2 = { distinct_id: this._instance.get_distinct_id(), token: i2 };
      this._shouldIncludeEvaluationEnvironments() && (r2.evaluation_contexts = this._getValidEvaluationEnvironments());
      var s2 = this._getValidFlagKeys();
      lt(s2) || (r2.flag_keys = s2), this._instance._send_request({ method: "POST", url: this._instance.requestRouter.endpointFor("flags", "/flags/?v=2"), data: r2, compression: this._config.disable_compression ? void 0 : eo.Base64, timestampMode: "body", timeout: this._config.feature_flag_request_timeout_ms, callback(i3) {
        var r3, s3 = null == (r3 = i3.json) ? void 0 : r3.featureFlagPayloads;
        t2((null == s3 ? void 0 : s3[e2]) || void 0);
      } });
    }
    isFeatureEnabled(e2, t2) {
      if (void 0 === t2 && (t2 = {}), t2.fresh && !this._flagsLoadedFromRemote) return t2.defaultValue;
      if (!(this._hasLoadedFlags || this.getFlags() && this.getFlags().length > 0)) return yl.warn('isFeatureEnabled for key "' + e2 + wl), t2.defaultValue;
      var i2 = this.getFeatureFlag(e2, t2);
      return lt(i2) ? t2.defaultValue : !!i2;
    }
    addFeatureFlagsHandler(e2) {
      this.featureFlagEventHandlers.push(e2);
    }
    removeFeatureFlagsHandler(e2) {
      this.featureFlagEventHandlers = this.featureFlagEventHandlers.filter((t2) => t2 !== e2);
    }
    receivedFeatureFlags(e2, t2, r2) {
      if (this._persistence) {
        this._hasLoadedFlags = true;
        var s2 = this.getFlagVariants(), n2 = this.getFlagPayloads(), o2 = this.getFlagsWithDetails();
        !function(e3, t3, r3, s3, n3, o3) {
          void 0 === r3 && (r3 = {}), void 0 === s3 && (s3 = {}), void 0 === n3 && (n3 = {});
          var a2 = ((e4) => {
            var t4 = e4.flags;
            return t4 ? (e4.featureFlags = Object.fromEntries(Object.keys(t4).map((e5) => {
              var i2;
              return [e5, null !== (i2 = t4[e5].variant) && void 0 !== i2 ? i2 : t4[e5].enabled];
            })), e4.featureFlagPayloads = Object.fromEntries(Object.keys(t4).filter((e5) => t4[e5].enabled).filter((e5) => {
              var i2;
              return null == (i2 = t4[e5].metadata) ? void 0 : i2.payload;
            }).map((e5) => {
              var i2;
              return [e5, null == (i2 = t4[e5].metadata) ? void 0 : i2.payload];
            }))) : e4.featureFlags && yl.warn("Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version"), e4;
          })(e3), l2 = a2.flags, u2 = a2.featureFlags, c2 = a2.featureFlagPayloads;
          if (u2) {
            var d2 = e3.requestId, _2 = e3.evaluatedAt;
            if (st(u2)) {
              yl.warn("v1 of the feature flags endpoint is deprecated. Please use the latest version.");
              var h2 = {};
              if (u2) for (var p2 = 0; u2.length > p2; p2++) h2[u2[p2]] = true;
              t3 && t3.register({ [F]: u2, [T]: h2, [O]: false });
            } else {
              var g2 = u2, v2 = c2, f2 = l2;
              if (null != o3 && o3.partialResponse) g2 = i({}, r3, g2), v2 = i({}, s3, v2), f2 = i({}, n3, f2);
              else if (e3.errorsWhileComputingFlags) if (l2) {
                var m2 = new Set(Object.keys(l2).filter((e4) => {
                  var t4;
                  return !(null != (t4 = l2[e4]) && t4.failed);
                }));
                g2 = i({}, r3, Object.fromEntries(Object.entries(g2).filter((e4) => m2.has(e4[0])))), v2 = i({}, s3, Object.fromEntries(Object.entries(v2 || {}).filter((e4) => m2.has(e4[0])))), f2 = i({}, n3, Object.fromEntries(Object.entries(f2 || {}).filter((e4) => m2.has(e4[0]))));
              } else g2 = i({}, r3, g2), v2 = i({}, s3, v2), f2 = i({}, n3, f2);
              t3 && t3.register(i({ [F]: Object.keys(El(g2)), [T]: g2 || {}, [M]: v2 || {}, [L]: f2 || {}, [O]: true === e3.minimalFlagCalledEvents }, d2 ? { [A]: d2 } : {}, _2 ? { [Q]: _2 } : {}));
            }
          }
        }(e2, this._persistence, s2, n2, o2, r2), t2 || (this._staleCacheRefreshTriggered = false), this._fireFeatureFlagsCallbacks(t2);
      }
    }
    override(e2, t2) {
      void 0 === t2 && (t2 = false), yl.warn("override is deprecated. Please use overrideFeatureFlags instead."), this.overrideFeatureFlags({ flags: e2, suppressWarning: t2 });
    }
    overrideFeatureFlags(e2) {
      if (!this._instance.__loaded || !this._persistence) return yl.uninitializedWarning("posthog.featureFlags.overrideFeatureFlags");
      if (false === e2) return this._persistence.unregister(D), this._persistence.unregister(N), this._fireFeatureFlagsCallbacks(), bl.info("All overrides cleared");
      if (st(e2)) {
        var t2 = Sl(e2);
        return this._persistence.register({ [D]: t2 }), this._fireFeatureFlagsCallbacks(), bl.info("Flag overrides set", { flags: e2 });
      }
      if (e2 && "object" == typeof e2 && ("flags" in e2 || "payloads" in e2)) {
        var i2, r2 = e2;
        if (this._override_warning = Boolean(null !== (i2 = r2.suppressWarning) && void 0 !== i2 && i2), "flags" in r2) {
          if (false === r2.flags) this._persistence.unregister(D), bl.info("Flag overrides cleared");
          else if (r2.flags) {
            if (st(r2.flags)) {
              var s2 = Sl(r2.flags);
              this._persistence.register({ [D]: s2 });
            } else this._persistence.register({ [D]: r2.flags });
            bl.info("Flag overrides set", { flags: r2.flags });
          }
        }
        return "payloads" in r2 && (false === r2.payloads ? (this._persistence.unregister(N), bl.info("Payload overrides cleared")) : r2.payloads && (this._persistence.register({ [N]: r2.payloads }), bl.info("Payload overrides set", { payloads: r2.payloads }))), void this._fireFeatureFlagsCallbacks();
      }
      if (e2 && "object" == typeof e2) return this._persistence.register({ [D]: e2 }), this._fireFeatureFlagsCallbacks(), bl.info("Flag overrides set", { flags: e2 });
      yl.warn("Invalid overrideOptions provided to overrideFeatureFlags", { overrideOptions: e2 });
    }
    onFeatureFlags(e2) {
      if (this.addFeatureFlagsHandler(e2), this._hasLoadedFlags) {
        var t2 = this._prepareFeatureFlagsForCallbacks(), i2 = t2.flags, r2 = t2.flagVariants;
        try {
          e2(i2, r2);
        } catch (e3) {
          yl.error("Error while running feature flags callback", e3);
        }
      }
      return () => this.removeFeatureFlagsHandler(e2);
    }
    updateEarlyAccessFeatureEnrollment(e2, t2, r2) {
      var s2, n2 = (this._prop(R) || []).find((t3) => t3.flagKey === e2), o2 = { ["$feature_enrollment/" + e2]: t2 }, a2 = { $feature_flag: e2, $feature_enrollment: t2, $set: o2 };
      n2 && (a2.$early_access_feature_name = n2.name), r2 && (a2.$feature_enrollment_stage = r2), this._instance.capture("$feature_enrollment_update", a2), this.setPersonPropertiesForFlags(o2, false);
      var l2 = i({}, this.getFlagVariants(), { [e2]: t2 });
      null == (s2 = this._persistence) || s2.register({ [F]: Object.keys(El(l2)), [T]: l2 }), this._fireFeatureFlagsCallbacks();
    }
    getEarlyAccessFeatures(e2, t2, i2) {
      void 0 === t2 && (t2 = false);
      var r2 = this._prop(R), s2 = i2 ? "&" + i2.map((e3) => "stage=" + e3).join("&") : "";
      if (r2 && !t2) return e2(r2);
      this._instance._send_request({ url: this._instance.requestRouter.endpointFor("api", "/api/early_access_features/?token=" + this._config.token + s2), method: "GET", timestampMode: "query", callback: (t3) => {
        var i3, r3;
        if (t3.json) {
          var s3 = t3.json.earlyAccessFeatures;
          return null == (i3 = this._persistence) || i3.unregister(R), null == (r3 = this._persistence) || r3.register({ [R]: s3 }), e2(s3);
        }
      } });
    }
    _prepareFeatureFlagsForCallbacks() {
      var e2 = this.getFlags(), t2 = this.getFlagVariants();
      return { flags: e2.filter((e3) => t2[e3]), flagVariants: Object.keys(t2).filter((e3) => t2[e3]).reduce((e3, i2) => (e3[i2] = t2[i2], e3), {}) };
    }
    _fireFeatureFlagsCallbacks(e2) {
      var t2 = this._prepareFeatureFlagsForCallbacks(), i2 = t2.flags, r2 = t2.flagVariants;
      this.featureFlagEventHandlers.forEach((t3) => {
        try {
          t3(i2, r2, { errorsLoading: e2 });
        } catch (e3) {
          yl.error("Error while running feature flags callback", e3);
        }
      });
    }
    setPersonPropertiesForFlags(e2, t2) {
      void 0 === t2 && (t2 = true);
      var r2 = this._prop(B) || {}, s2 = (null == e2 ? void 0 : e2.$set) || (null != e2 && e2.$set_once ? {} : e2), n2 = null == e2 ? void 0 : e2.$set_once, o2 = {};
      if (n2) for (var a2 in n2) ({}).hasOwnProperty.call(n2, a2) && (a2 in r2 || (o2[a2] = n2[a2]));
      this._instance.register({ [B]: i({}, r2, o2, s2) }), t2 && this._instance.reloadFeatureFlags();
    }
    unsetPersonPropertiesForFlags(e2, t2) {
      void 0 === t2 && (t2 = true);
      var r2 = i({}, this._prop(B) || {});
      e2.forEach((e3) => {
        delete r2[e3];
      }), this._instance.register({ [B]: r2 }), t2 && this._instance.reloadFeatureFlags();
    }
    resetPersonPropertiesForFlags(e2) {
      void 0 === e2 && (e2 = true), this._instance.unregister(B), e2 && this._instance.reloadFeatureFlags();
    }
    setGroupPropertiesForFlags(e2, t2) {
      void 0 === t2 && (t2 = true);
      var r2 = this._prop(q) || {};
      0 !== Object.keys(r2).length && Object.keys(r2).forEach((t3) => {
        r2[t3] = i({}, r2[t3], e2[t3]), delete e2[t3];
      }), this._instance.register({ [q]: i({}, r2, e2) }), t2 && this._instance.reloadFeatureFlags();
    }
    resetGroupPropertiesForFlags(e2) {
      if (e2) {
        var t2 = this._prop(q) || {};
        this._instance.register({ [q]: i({}, t2, { [e2]: {} }) });
      } else this._instance.unregister(q);
    }
    reset() {
      this._hasLoadedFlags = false, this._requestInFlight = false, this._reloadingDisabled = false, this._additionalReloadRequested = false, this._flagsLoadedFromRemote = false, this.$anon_distinct_id = void 0, this._clearDebouncer(), this._override_warning = false, this._consecutiveStatusZeroFailures = 0;
    }
  } };
  var Ll = { sessionRecording: class {
    get _config() {
      return this._instance.config;
    }
    get _persistence() {
      return this._instance.persistence;
    }
    get started() {
      var e2;
      return !(null == (e2 = this._lazyLoadedSessionRecording) || !e2.isStarted);
    }
    get status() {
      var e2, t2;
      return this._recordingStatus === Xa || this._recordingStatus === el ? this._recordingStatus : null !== (e2 = null == (t2 = this._lazyLoadedSessionRecording) ? void 0 : t2.status) && void 0 !== e2 ? e2 : this._recordingStatus;
    }
    constructor(e2) {
      if (this._forceAllowLocalhostNetworkCapture = false, this._recordingStatus = Ja, this._persistFlagsOnSessionListener = void 0, this._instance = e2, !this._instance.sessionManager) throw il.error("started without valid sessionManager"), new Error(tl + " started without valid sessionManager. This is a bug.");
      if (this._config.cookieless_mode === ce) throw new Error(tl + ' cannot be used with cookieless_mode="always"');
    }
    initialize() {
      this.startIfEnabledOrStop();
    }
    get _isRecordingEnabled() {
      var e2, t2 = !(null == (e2 = this._instance.get_property(w)) || !e2.enabled), i2 = !this._config.disable_session_recording, r2 = this._config.disable_session_recording || this._instance.consent.isOptedOut();
      return be && t2 && i2 && !r2;
    }
    startIfEnabledOrStop(e2) {
      var t2;
      if (!this._isRecordingEnabled || null == (t2 = this._lazyLoadedSessionRecording) || !t2.isStarted) {
        var i2 = !lt(Object.assign) && !lt(Array.from);
        this._isRecordingEnabled && i2 ? (this._lazyLoadAndStart(e2), il.info("starting")) : (this._recordingStatus = Ja, this.stopRecording());
      }
    }
    _lazyLoadAndStart(e2) {
      var t2, i2, r2;
      this._isRecordingEnabled && (this._recordingStatus !== Xa && this._recordingStatus !== el && (this._recordingStatus = Za), null != Le && null != (t2 = Le.__PosthogExtensions__) && null != (t2 = t2.rrweb) && t2.record && null != (i2 = Le.__PosthogExtensions__) && i2.initSessionRecording ? this._onScriptLoaded(e2) : null == (r2 = Le.__PosthogExtensions__) || null == r2.loadExternalDependency || r2.loadExternalDependency(this._instance, this._scriptName, (t3) => {
        if (t3) return il.error("could not load recorder", t3);
        this._onScriptLoaded(e2);
      }));
    }
    stopRecording() {
      var e2, t2;
      null == (e2 = this._persistFlagsOnSessionListener) || e2.call(this), this._persistFlagsOnSessionListener = void 0, null == (t2 = this._lazyLoadedSessionRecording) || t2.stop();
    }
    _discardRecording() {
      var e2, t2;
      null == (e2 = this._persistFlagsOnSessionListener) || e2.call(this), this._persistFlagsOnSessionListener = void 0, null == (t2 = this._lazyLoadedSessionRecording) || t2.discard();
    }
    _resetSampling() {
      var e2, t2;
      null == (e2 = this._persistence) || e2.unregister(C), null == (t2 = this._persistence) || t2.unregister(S);
    }
    _validateSampleRate(e2, t2) {
      if (_t(e2)) return null;
      var i2, r2 = ht(e2) ? e2 : parseFloat(e2);
      return "number" != typeof (i2 = r2) || !Number.isFinite(i2) || 0 > i2 || i2 > 1 ? (il.warn(t2 + " must be between 0 and 1. Ignoring invalid value:", e2), null) : r2;
    }
    _persistRemoteConfig(e2) {
      if (this._persistence) {
        var t2, r2, s2 = this._persistence, n2 = () => {
          var t3, r3 = false === e2.sessionRecording ? void 0 : e2.sessionRecording, n3 = this._validateSampleRate(null == (t3 = this._config.session_recording) ? void 0 : t3.sampleRate, "session_recording.sampleRate"), o2 = this._validateSampleRate(null == r3 ? void 0 : r3.sampleRate, "remote config sampleRate"), a2 = null != n3 ? n3 : o2;
          _t(a2) && this._resetSampling();
          var l2 = null == r3 ? void 0 : r3.minimumDurationMilliseconds;
          s2.register({ [w]: i({ cache_timestamp: Date.now(), enabled: !!r3 }, r3, { networkPayloadCapture: i({ capturePerformance: e2.capturePerformance }, null == r3 ? void 0 : r3.networkPayloadCapture), canvasRecording: { enabled: null == r3 ? void 0 : r3.recordCanvas, fps: null == r3 ? void 0 : r3.canvasFps, quality: null == r3 ? void 0 : r3.canvasQuality }, sampleRate: a2, minimumDurationMilliseconds: lt(l2) ? null : l2, endpoint: null == r3 ? void 0 : r3.endpoint, triggerMatchType: null == r3 ? void 0 : r3.triggerMatchType, masking: null == r3 ? void 0 : r3.masking, urlTriggers: null == r3 ? void 0 : r3.urlTriggers, version: null == r3 ? void 0 : r3.version, triggerGroups: null == r3 ? void 0 : r3.triggerGroups }) });
        };
        n2(), null == (t2 = this._persistFlagsOnSessionListener) || t2.call(this), this._persistFlagsOnSessionListener = null == (r2 = this._instance.sessionManager) ? void 0 : r2.onSessionId(n2);
      }
    }
    onRemoteConfig(e2) {
      var t2 = e2.ok ? e2.config : void 0;
      return t2 && "sessionRecording" in t2 ? false === t2.sessionRecording ? (this._persistRemoteConfig(t2), void this._discardRecording()) : (this._persistRemoteConfig(t2), void this.startIfEnabledOrStop()) : (this._recordingStatus === Xa && (this._recordingStatus = el, il.warn("config refresh failed, recording will not start until page reload")), void this.startIfEnabledOrStop());
    }
    log(e2, t2) {
      var i2;
      void 0 === t2 && (t2 = "log"), null != (i2 = this._lazyLoadedSessionRecording) && i2.log ? this._lazyLoadedSessionRecording.log(e2, t2) : il.warn("log called before recorder was ready");
    }
    get _scriptName() {
      var e2, t2, i2 = null == (e2 = this._instance) || null == (e2 = e2.persistence) ? void 0 : e2.get_property(w);
      return (null == i2 || null == (t2 = i2.scriptConfig) ? void 0 : t2.script) || "lazy-recorder";
    }
    _isRemoteConfigFresh() {
      var e2, t2, i2 = this._instance.get_property(w);
      if (!i2) return false;
      try {
        t2 = "object" == typeof i2 ? i2 : JSON.parse(i2);
      } catch (e3) {
        return il.warn("persisted remote config for session recording is invalid and will be ignored", e3), false;
      }
      var r2 = null !== (e2 = t2.cache_timestamp) && void 0 !== e2 ? e2 : Date.now();
      return 36e5 >= Date.now() - r2;
    }
    _onScriptLoaded(e2) {
      var t2, i2;
      if (null == (t2 = Le.__PosthogExtensions__) || !t2.initSessionRecording) return il.warn("Called on script loaded before session recording is available. This can be caused by adblockers."), void this._instance.register_for_session({ [ae]: true });
      if (this._lazyLoadedSessionRecording || (this._lazyLoadedSessionRecording = null == (i2 = Le.__PosthogExtensions__) ? void 0 : i2.initSessionRecording(this._instance), this._lazyLoadedSessionRecording._forceAllowLocalhostNetworkCapture = this._forceAllowLocalhostNetworkCapture), !this._isRemoteConfigFresh()) {
        if (this._recordingStatus === el || this._recordingStatus === Xa) return;
        return this._recordingStatus = Xa, il.info("persisted remote config is stale, requesting fresh config before starting"), void new Zn(this._instance).load();
      }
      this._recordingStatus = Za, this._lazyLoadedSessionRecording.start(e2);
    }
    onRRwebEmit(e2) {
      var t2;
      null == (t2 = this._lazyLoadedSessionRecording) || null == t2.onRRwebEmit || t2.onRRwebEmit(e2);
    }
    overrideLinkedFlag() {
      var e2, t2;
      this._lazyLoadedSessionRecording || null == (t2 = this._persistence) || t2.register({ [x]: true }), null == (e2 = this._lazyLoadedSessionRecording) || e2.overrideLinkedFlag();
    }
    overrideSampling() {
      var e2, t2;
      this._lazyLoadedSessionRecording || null == (t2 = this._persistence) || t2.register({ [E]: true }), null == (e2 = this._lazyLoadedSessionRecording) || e2.overrideSampling();
    }
    overrideTrigger(e2) {
      var t2, i2;
      this._lazyLoadedSessionRecording || null == (i2 = this._persistence) || i2.register({ ["url" === e2 ? k : P]: true }), null == (t2 = this._lazyLoadedSessionRecording) || t2.overrideTrigger(e2);
    }
    get sdkDebugProperties() {
      var e2;
      return (null == (e2 = this._lazyLoadedSessionRecording) ? void 0 : e2.sdkDebugProperties) || { $recording_status: this.status };
    }
    tryAddCustomEvent(e2, t2) {
      var i2;
      return !(null == (i2 = this._lazyLoadedSessionRecording) || !i2.tryAddCustomEvent(e2, t2));
    }
  } };
  var Ml = { autocapture: class {
    constructor(e2) {
      this._initialized = false, this._isDisabledServerSide = null, this._hasReceivedConfigResponse = false, this._elementsChainAsString = false, this.instance = e2, this.rageclicks = new qa(e2.config.rageclick), this._elementSelectors = null;
    }
    initialize() {
      this.startIfEnabled();
    }
    get _config() {
      var e2, t2, i2 = ot(this.instance.config.autocapture) ? this.instance.config.autocapture : {};
      return i2.url_allowlist = null == (e2 = i2.url_allowlist) ? void 0 : e2.map((e3) => new RegExp(e3)), i2.url_ignorelist = null == (t2 = i2.url_ignorelist) ? void 0 : t2.map((e3) => new RegExp(e3)), i2;
    }
    _addDomEventHandlers() {
      if (this.isBrowserSupported()) {
        if (be && Ee) {
          var e2 = (e3) => {
            e3 = e3 || (null == be ? void 0 : be.event);
            try {
              this._captureEvent(e3);
            } catch (e4) {
              Ha.error("Failed to capture event", e4);
            }
          };
          if (qr(Ee, "submit", e2, { capture: true }), qr(Ee, "change", e2, { capture: true }), qr(Ee, "click", e2, { capture: true }), this._config.capture_copied_text) {
            var t2 = (e3) => {
              e3 = e3 || (null == be ? void 0 : be.event);
              try {
                this._captureEvent(e3, Ua);
              } catch (e4) {
                Ha.error("Failed to capture copy/cut event", e4);
              }
            };
            qr(Ee, "copy", t2, { capture: true }), qr(Ee, "cut", t2, { capture: true });
          }
        }
      } else Ha.info("Disabling Automatic Event Collection because this browser is not supported");
    }
    startIfEnabled() {
      this.isEnabled && !this._initialized && (this._addDomEventHandlers(), this._initialized = true);
    }
    onRemoteConfig(e2) {
      if (this._hasReceivedConfigResponse = true, e2.ok) {
        var t2 = e2.config;
        t2.elementsChainAsString && (this._elementsChainAsString = t2.elementsChainAsString);
        var i2 = t2.autocapture_opt_out;
        gt(i2) && (this.instance.persistence && this.instance.persistence.register({ [_]: i2 }), this._isDisabledServerSide = i2), this.startIfEnabled();
      } else this.startIfEnabled();
    }
    setElementSelectors(e2) {
      this._elementSelectors = e2;
    }
    getElementSelectors(e2) {
      var t2, i2 = [];
      return null == (t2 = this._elementSelectors) || t2.forEach((t3) => {
        var r2 = null == Ee ? void 0 : Ee.querySelectorAll(t3);
        null == r2 || r2.forEach((r3) => {
          e2 === r3 && i2.push(t3);
        });
      }), i2;
    }
    get isEnabled() {
      var e2, t2, i2 = null == (e2 = this.instance.persistence) ? void 0 : e2.props[_], r2 = this._isDisabledServerSide, s2 = this.instance._shouldDisableFlags() && !this._hasReceivedConfigResponse;
      if (dt(r2) && !gt(i2) && !s2) return false;
      var n2 = null !== (t2 = this._isDisabledServerSide) && void 0 !== t2 ? t2 : !!i2;
      return !!this.instance.config.autocapture && !n2;
    }
    _captureEvent(e2, t2) {
      if (void 0 === t2 && (t2 = "$autocapture"), this.isEnabled) {
        var i2, r2 = Es(e2);
        gs(r2) && (r2 = r2.parentNode || null), "$autocapture" === t2 && "click" === e2.type && e2 instanceof MouseEvent && this.instance.config.rageclick && null != (i2 = this.rageclicks) && i2.isRageClick(e2.clientX, e2.clientY, e2.timeStamp || (/* @__PURE__ */ new Date()).getTime()) && Ms(r2, this.instance.config.rageclick) && this._captureEvent(e2, "$rageclick");
        var s2 = t2 === Ua;
        if (r2 && function(e3, t3, i3, r3, s3, n3) {
          var o3;
          if (!be || As(e3)) return false;
          if (null != i3 && i3.url_allowlist && !ys(i3.url_allowlist, n3)) return false;
          if (null != i3 && i3.url_ignorelist && ys(i3.url_ignorelist, n3)) return false;
          if (null != i3 && i3.dom_event_allowlist) {
            var a3 = i3.dom_event_allowlist;
            if (a3 && !a3.some((e4) => t3.type === e4)) return false;
          }
          var l3 = $s(e3, r3), u3 = l3.parentIsUsefulElement, c3 = l3.targetElementList;
          if (!function(e4, t4) {
            var i4 = null == t4 ? void 0 : t4.element_allowlist;
            if (lt(i4)) return true;
            var r4, s4 = function(e5) {
              if (i4.some((t5) => e5.tagName.toLowerCase() === t5)) return { v: true };
            };
            for (var n4 of e4) if (r4 = s4(n4)) return r4.v;
            return false;
          }(c3, i3)) return false;
          if (!ks(c3, null == i3 ? void 0 : i3.css_selector_allowlist)) return false;
          if (ks(c3, null !== (o3 = null == i3 ? void 0 : i3.css_selector_ignorelist) && void 0 !== o3 ? o3 : Is)) return false;
          try {
            var d2 = be.getComputedStyle(e3);
            if (d2 && "pointer" === d2.getPropertyValue("cursor") && "click" === t3.type) return true;
          } catch (e4) {
          }
          var _2 = e3.tagName.toLowerCase();
          switch (_2) {
            case "html":
              return false;
            case "form":
              return (s3 || ["submit"]).indexOf(t3.type) >= 0;
            case "input":
            case "select":
            case "textarea":
              return (s3 || ["change", "click"]).indexOf(t3.type) >= 0;
            default:
              return u3 ? (s3 || ["click"]).indexOf(t3.type) >= 0 : (s3 || ["click"]).indexOf(t3.type) >= 0 && (xs.indexOf(_2) > -1 || "true" === e3.getAttribute("contenteditable"));
          }
        }(r2, e2, this._config, s2, s2 ? ["copy", "cut"] : void 0, this.instance)) {
          var n2 = Va(r2, { e: e2, maskAllElementAttributes: this.instance.config.mask_all_element_attributes, maskAllText: this.instance.config.mask_all_text, elementAttributeIgnoreList: this._config.element_attribute_ignorelist, elementsChainAsString: this._elementsChainAsString, disableCaptureUrlHashes: this.instance.config.disable_capture_url_hashes }), o2 = n2.props;
          if (n2.explicitNoCapture) return false;
          var a2 = this.getElementSelectors(r2);
          if (a2 && a2.length > 0 && (o2.$element_selectors = a2), t2 === Ua) {
            var l2, u2 = ws(null == be || null == (l2 = be.getSelection()) ? void 0 : l2.toString()), c2 = e2.type || "clipboard";
            if (!u2) return false;
            o2.$selected_content = u2, o2.$copy_type = c2;
          }
          return this.instance.capture(t2, o2), true;
        }
      }
    }
    isBrowserSupported() {
      return nt(null == Ee ? void 0 : Ee.querySelectorAll);
    }
  }, historyAutocapture: class {
    constructor(e2) {
      var t2;
      this._instance = e2, this._lastPathname = (null == be || null == (t2 = be.location) ? void 0 : t2.pathname) || "";
    }
    initialize() {
      this.startIfEnabled();
    }
    get isEnabled() {
      return "history_change" === this._instance.config.capture_pageview;
    }
    startIfEnabled() {
      this.isEnabled && (Tr.info("History API monitoring enabled, starting..."), this.monitorHistoryChanges());
    }
    stop() {
      this._popstateListener && this._popstateListener(), this._popstateListener = void 0, Tr.info("History API monitoring stopped");
    }
    monitorHistoryChanges() {
      be && be.history && (this._patchHistoryMethod("pushState"), this._patchHistoryMethod("replaceState"), this._setupPopstateListener());
    }
    _patchHistoryMethod(e2) {
      var t2;
      if (be && (null == (t2 = be.history[e2]) || !t2.__posthog_wrapped__)) {
        var i2 = this;
        !function(e3, t3, i3) {
          try {
            if (!(t3 in e3)) return Ga;
            var r2 = { next: e3[t3] }, s2 = i3(function() {
              for (var e4 = arguments.length, t4 = new Array(e4), i4 = 0; e4 > i4; i4++) t4[i4] = arguments[i4];
              return r2.next.apply(this, t4);
            });
            return nt(s2) && (s2.prototype = s2.prototype || {}, Object.defineProperties(s2, { __posthog_wrapped__: { enumerable: false, value: true }, __posthog_layer__: { enumerable: false, value: r2 } })), e3[t3] = s2, () => {
              if (e3[t3] !== s2) for (var i4 = e3[t3]; nt(i4) && i4.__posthog_layer__; ) {
                var n2 = i4.__posthog_layer__;
                if (n2.next === s2) return void (n2.next = r2.next);
                i4 = n2.next;
              }
              else e3[t3] = r2.next;
            };
          } catch (e4) {
            return Ga;
          }
        }(be.history, e2, (t3) => function(r2, s2, n2) {
          t3.call(this, r2, s2, n2), i2._capturePageview(e2);
        });
      }
    }
    _capturePageview(e2) {
      try {
        var t2, i2 = null == be || null == (t2 = be.location) ? void 0 : t2.pathname;
        if (!i2) return;
        i2 !== this._lastPathname && this.isEnabled && this._instance.capture(ve, { navigation_type: e2 }), this._lastPathname = i2;
      } catch (t3) {
        Tr.error("Error capturing " + e2 + " pageview", t3);
      }
    }
    _setupPopstateListener() {
      if (!this._popstateListener) {
        var e2 = () => {
          this._capturePageview("popstate");
        };
        qr(be, "popstate", e2), this._popstateListener = () => {
          be && be.removeEventListener("popstate", e2);
        };
      }
    }
  }, heatmaps: class {
    get _config() {
      return this.instance.config;
    }
    constructor(e2) {
      var t2;
      this._enabledServerSide = false, this._initialized = false, this._flushInterval = null, this.instance = e2, this._enabledServerSide = !(null == (t2 = this.instance.persistence) || !t2.props[h]), this.rageclicks = new qa(e2.config.rageclick);
    }
    initialize() {
      this.startIfEnabled();
    }
    get flushIntervalMilliseconds() {
      var e2 = 5e3;
      return ot(this._config.capture_heatmaps) && this._config.capture_heatmaps.flush_interval_milliseconds && (e2 = this._config.capture_heatmaps.flush_interval_milliseconds), e2;
    }
    get isEnabled() {
      return _t(this._config.capture_heatmaps) ? _t(this._config.enable_heatmaps) ? this._enabledServerSide : this._config.enable_heatmaps : false !== this._config.capture_heatmaps;
    }
    startIfEnabled() {
      if (this.isEnabled) {
        if (this._initialized) return;
        rl.info("starting..."), this._setupListeners(), this._onVisibilityChange();
      } else {
        var e2;
        clearInterval(null !== (e2 = this._flushInterval) && void 0 !== e2 ? e2 : void 0), this._removeListeners(), this.getAndClearBuffer();
      }
    }
    onRemoteConfig(e2) {
      if (e2.ok) {
        var t2 = e2.config;
        if ("heatmaps" in t2) {
          var i2 = !!t2.heatmaps;
          this.instance.persistence && this.instance.persistence.register({ [h]: i2 }), this._enabledServerSide = i2, this.startIfEnabled();
        }
      }
    }
    getAndClearBuffer() {
      var e2 = this._buffer;
      return this._buffer = void 0, e2;
    }
    _onDeadClick(e2) {
      sl(e2.originalEvent) && this._onClick(e2.originalEvent, "deadclick");
    }
    _onVisibilityChange() {
      this._flushInterval && clearInterval(this._flushInterval), this._flushInterval = "visible" === (null == Ee ? void 0 : Ee.visibilityState) ? setInterval(this._flush.bind(this), this.flushIntervalMilliseconds) : null;
    }
    _setupListeners() {
      be && Ee && (this._flushHandler = this._flush.bind(this), qr(be, ge, this._flushHandler), this._onClickHandler = (e2) => this._onClick(e2 || (null == be ? void 0 : be.event)), qr(Ee, "click", this._onClickHandler, { capture: true }), this._onMouseMoveHandler = (e2) => this._onMouseMove(e2 || (null == be ? void 0 : be.event)), qr(Ee, "mousemove", this._onMouseMoveHandler, { capture: true }), this._deadClicksCapture = new Zs(this.instance, Ys, this._onDeadClick.bind(this)), this._deadClicksCapture.startIfEnabledOrStop(), this._onVisibilityChange_handler = this._onVisibilityChange.bind(this), qr(Ee, pe, this._onVisibilityChange_handler), this._initialized = true);
    }
    _removeListeners() {
      var e2;
      be && Ee && (this._flushHandler && be.removeEventListener(ge, this._flushHandler), this._onClickHandler && Ee.removeEventListener("click", this._onClickHandler, { capture: true }), this._onMouseMoveHandler && Ee.removeEventListener("mousemove", this._onMouseMoveHandler, { capture: true }), this._onVisibilityChange_handler && Ee.removeEventListener(pe, this._onVisibilityChange_handler), clearTimeout(this._mouseMoveTimeout), null == (e2 = this._deadClicksCapture) || e2.stop(), this._initialized = false);
    }
    _getProperties(e2, t2) {
      var i2 = this.instance.scrollManager.scrollY(), r2 = this.instance.scrollManager.scrollX(), s2 = this.instance.scrollManager.scrollElement(), n2 = function(e3, t3, i3) {
        for (var r3 = e3; r3 && hs(r3) && !ps(r3, "body"); ) {
          if (r3 === i3) return false;
          var s3 = void 0;
          try {
            var n3, o2, a2;
            s3 = null == (n3 = null !== (o2 = null == (a2 = r3.ownerDocument) ? void 0 : a2.defaultView) && void 0 !== o2 ? o2 : be) ? void 0 : n3.getComputedStyle(r3).position;
          } catch (e4) {
            return false;
          }
          if (Je(t3, s3)) return true;
          r3 = Ps(r3);
        }
        return false;
      }(Es(e2), ["fixed", "sticky"], s2);
      return { x: e2.clientX + (n2 ? 0 : r2), y: e2.clientY + (n2 ? 0 : i2), target_fixed: n2, type: t2 };
    }
    _onClick(e2, t2) {
      var r2;
      if (void 0 === t2 && (t2 = "click"), !_s(e2.target) && sl(e2)) {
        var s2 = this._getProperties(e2, t2);
        null != (r2 = this.rageclicks) && r2.isRageClick(e2.clientX, e2.clientY, (/* @__PURE__ */ new Date()).getTime()) && Ms(Es(e2), this.instance.config.rageclick) && this._capture(i({}, s2, { type: "rageclick" })), this._capture(s2);
      }
    }
    _onMouseMove(e2) {
      !_s(e2.target) && sl(e2) && (clearTimeout(this._mouseMoveTimeout), this._mouseMoveTimeout = setTimeout(() => {
        this._capture(this._getProperties(e2, "mousemove"));
      }, 500));
    }
    _capture(e2) {
      if (be) {
        var t2 = this._config.disable_capture_url_hashes ? Mi(be.location.href) : be.location.href, i2 = this._config.custom_personal_data_properties, r2 = this._config.mask_personal_data_properties ? [...fn, ...i2 || []] : [], s2 = _n(t2, r2, yn);
        this._buffer = this._buffer || {}, this._buffer[s2] || (this._buffer[s2] = []), this._buffer[s2].push(e2);
      }
    }
    _flush() {
      this._buffer && !at(this._buffer) && this.instance.capture("$$heatmap", { $heatmap_data: this.getAndClearBuffer() });
    }
  }, deadClicksAutocapture: Zs, webVitalsAutocapture: class {
    constructor(e2) {
      var t2;
      this._enabledServerSide = false, this._initialized = false, this._buffer = { url: void 0, metrics: [], firstMetricTimestamp: void 0 }, this._flushToCapture = () => {
        clearTimeout(this._delayedFlushTimer), 0 !== this._buffer.metrics.length && (this._instance.capture("$web_vitals", this._buffer.metrics.reduce((e3, t3) => i({}, e3, { ["$web_vitals_" + t3.name + "_event"]: i({}, t3), ["$web_vitals_" + t3.name + "_value"]: t3.value }), {})), this._buffer = { url: void 0, metrics: [], firstMetricTimestamp: void 0 });
      }, this._addToBuffer = (e3) => {
        var t3;
        this._buffer = this._buffer || { url: void 0, metrics: [], firstMetricTimestamp: void 0 };
        var r2 = this._currentURL();
        if (!lt(r2)) if (_t(null == e3 ? void 0 : e3.name) || _t(null == e3 ? void 0 : e3.value)) Qa.error("Invalid metric received", e3);
        else if (!this._maxAllowedValue || this._maxAllowedValue > e3.value) {
          this._buffer.url !== r2 && (this._flushToCapture(), this._delayedFlushTimer = setTimeout(this._flushToCapture, this.flushToCaptureTimeoutMs)), lt(this._buffer.url) && (this._buffer.url = r2), this._buffer.firstMetricTimestamp = lt(this._buffer.firstMetricTimestamp) ? Date.now() : this._buffer.firstMetricTimestamp, e3.attribution && e3.attribution.interactionTargetElement && (e3.attribution.interactionTargetElement = void 0);
          var s2 = null == (t3 = this._instance.sessionManager) ? void 0 : t3.checkAndGetSessionAndWindowId(true), n2 = i({}, e3, { $current_url: r2, timestamp: Date.now() });
          lt(s2) || (n2.$session_id = s2.sessionId, n2.$window_id = s2.windowId), this._buffer.metrics.push(n2), this._buffer.metrics.length === this.allowedMetrics.length && this._flushToCapture();
        } else Qa.error("Ignoring metric with value >= " + this._maxAllowedValue, e3);
      }, this._startCapturing = () => {
        if (!this._initialized) {
          var e3, t3, i2, r2, s2 = Le.__PosthogExtensions__;
          if (!lt(s2) && !lt(s2.postHogWebVitalsCallbacks)) {
            var n2 = s2.postHogWebVitalsCallbacks;
            e3 = n2.onLCP, t3 = n2.onCLS, i2 = n2.onFCP, r2 = n2.onINP;
          }
          e3 && t3 && i2 && r2 ? (this.allowedMetrics.indexOf("LCP") > -1 && e3(this._addToBuffer.bind(this)), this.allowedMetrics.indexOf("CLS") > -1 && t3(this._addToBuffer.bind(this)), this.allowedMetrics.indexOf("FCP") > -1 && i2(this._addToBuffer.bind(this)), this.allowedMetrics.indexOf("INP") > -1 && r2(this._addToBuffer.bind(this)), this._initialized = true) : Qa.error("web vitals callbacks not loaded - not starting");
        }
      }, this._instance = e2, this._enabledServerSide = !(null == (t2 = this._instance.persistence) || !t2.props[f]), this.startIfEnabled();
    }
    get _perfConfig() {
      return this._instance.config.capture_performance;
    }
    get allowedMetrics() {
      var e2, t2, i2 = ot(this._perfConfig) ? null == (e2 = this._perfConfig) ? void 0 : e2.web_vitals_allowed_metrics : void 0;
      return _t(i2) ? (null == (t2 = this._instance.persistence) ? void 0 : t2.props[b]) || ["CLS", "FCP", "INP", "LCP"] : i2;
    }
    get flushToCaptureTimeoutMs() {
      return (ot(this._perfConfig) ? this._perfConfig.web_vitals_delayed_flush_ms : void 0) || 5e3;
    }
    get useAttribution() {
      var e2 = ot(this._perfConfig) ? this._perfConfig.web_vitals_attribution : void 0;
      return null != e2 && e2;
    }
    get _maxAllowedValue() {
      var e2 = ot(this._perfConfig) && ht(this._perfConfig.__web_vitals_max_value) ? this._perfConfig.__web_vitals_max_value : Ya;
      return e2 > 0 && 6e4 >= e2 ? Ya : e2;
    }
    get isEnabled() {
      var e2 = null == xe ? void 0 : xe.protocol;
      if ("http:" !== e2 && "https:" !== e2) return Qa.info("Web Vitals are disabled on non-http/https protocols"), false;
      var t2 = ot(this._perfConfig) ? this._perfConfig.web_vitals : gt(this._perfConfig) ? this._perfConfig : void 0;
      return gt(t2) ? t2 : this._enabledServerSide;
    }
    startIfEnabled() {
      this.isEnabled && !this._initialized && (Qa.info("enabled, starting..."), this._loadScript(this._startCapturing));
    }
    onRemoteConfig(e2) {
      if (e2.ok) {
        var t2 = e2.config;
        if ("capturePerformance" in t2) {
          var i2 = ot(t2.capturePerformance) && !!t2.capturePerformance.web_vitals, r2 = ot(t2.capturePerformance) ? t2.capturePerformance.web_vitals_allowed_metrics : void 0;
          this._instance.persistence && (this._instance.persistence.register({ [f]: i2 }), this._instance.persistence.register({ [b]: r2 })), this._enabledServerSide = i2, this.startIfEnabled();
        }
      }
    }
    _loadScript(e2) {
      var t2, i2;
      null != (t2 = Le.__PosthogExtensions__) && t2.postHogWebVitalsCallbacks ? e2() : null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, this.useAttribution ? "web-vitals-with-attribution" : "web-vitals", (t3) => {
        t3 ? Qa.error("failed to load script", t3) : e2();
      });
    }
    _currentURL() {
      var e2 = be ? this._instance.config.disable_capture_url_hashes ? Mi(be.location.href) : be.location.href : void 0;
      if (e2) {
        var t2 = this._instance.config.custom_personal_data_properties, i2 = this._instance.config.mask_personal_data_properties ? [...fn, ...t2 || []] : [];
        return _n(e2, i2, yn);
      }
      Qa.error("Could not determine current URL");
    }
  } };
  var Al = { exceptionObserver: class {
    constructor(e2) {
      var t2;
      this._startCapturing = () => {
        var e3;
        if (be && this.isEnabled && null != (e3 = Le.__PosthogExtensions__) && e3.errorWrappingFunctions) {
          var t3 = Le.__PosthogExtensions__.errorWrappingFunctions.wrapOnError, i2 = Le.__PosthogExtensions__.errorWrappingFunctions.wrapUnhandledRejection, r2 = Le.__PosthogExtensions__.errorWrappingFunctions.wrapConsoleError;
          try {
            !this._unwrapOnError && this._config.capture_unhandled_errors && (this._unwrapOnError = t3(this.captureException.bind(this))), !this._unwrapUnhandledRejection && this._config.capture_unhandled_rejections && (this._unwrapUnhandledRejection = i2(this.captureException.bind(this))), !this._unwrapConsoleError && this._config.capture_console_errors && (this._unwrapConsoleError = r2(this.captureException.bind(this)));
          } catch (e4) {
            Wa.error("failed to start", e4), this._stopCapturing();
          }
        }
      }, this._instance = e2, this._remoteEnabled = !(null == (t2 = this._instance.persistence) || !t2.props[p]), this._rateLimiter = new Pt(i({}, function(e3) {
        var t3, i2, r2, s2;
        return void 0 === e3 && (e3 = {}), { refillRate: null !== (t3 = null !== (i2 = e3.exceptionRateLimiterRefillRate) && void 0 !== i2 ? i2 : e3.__exceptionRateLimiterRefillRate) && void 0 !== t3 ? t3 : 1, bucketSize: null !== (r2 = null !== (s2 = e3.exceptionRateLimiterBucketSize) && void 0 !== s2 ? s2 : e3.__exceptionRateLimiterBucketSize) && void 0 !== r2 ? r2 : 10 };
      }(this._instance.config.error_tracking), { refillInterval: 1e4, _logger: Wa })), this._config = this._requiredConfig(), this.startIfEnabledOrStop();
    }
    _requiredConfig() {
      var e2 = this._instance.config.capture_exceptions, t2 = { capture_unhandled_errors: false, capture_unhandled_rejections: false, capture_console_errors: false };
      return ot(e2) ? t2 = i({}, t2, e2) : (lt(e2) ? this._remoteEnabled : e2) && (t2 = i({}, t2, { capture_unhandled_errors: true, capture_unhandled_rejections: true })), t2;
    }
    get isEnabled() {
      return this._config.capture_console_errors || this._config.capture_unhandled_errors || this._config.capture_unhandled_rejections;
    }
    startIfEnabledOrStop() {
      this.isEnabled ? (Wa.info("enabled"), this._stopCapturing(), this._loadScript(this._startCapturing)) : this._stopCapturing();
    }
    _loadScript(e2) {
      var t2, i2;
      null != (t2 = Le.__PosthogExtensions__) && t2.errorWrappingFunctions ? e2() : null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, "exception-autocapture", (t3) => {
        if (t3) return Wa.error("failed to load script", t3);
        e2();
      });
    }
    _stopCapturing() {
      var e2, t2, i2;
      null == (e2 = this._unwrapOnError) || e2.call(this), this._unwrapOnError = void 0, null == (t2 = this._unwrapUnhandledRejection) || t2.call(this), this._unwrapUnhandledRejection = void 0, null == (i2 = this._unwrapConsoleError) || i2.call(this), this._unwrapConsoleError = void 0;
    }
    onRemoteConfig(e2) {
      if (e2.ok) {
        var t2 = e2.config;
        "autocaptureExceptions" in t2 && (this._remoteEnabled = !!t2.autocaptureExceptions || false, this._instance.persistence && this._instance.persistence.register({ [p]: this._remoteEnabled }), this._config = this._requiredConfig(), this.startIfEnabledOrStop());
      }
    }
    onConfigChange() {
      this._config = this._requiredConfig();
    }
    captureException(e2) {
      var t2, i2, r2, s2 = null !== (t2 = null == e2 || null == (i2 = e2.$exception_list) || null == (i2 = i2[0]) ? void 0 : i2.type) && void 0 !== t2 ? t2 : "Exception";
      this._rateLimiter.consumeRateLimit(s2) ? Wa.info("Skipping exception capture because of client rate limiting.", { exception: s2 }) : null == (r2 = this._instance.exceptions) || r2.sendExceptionEvent(e2);
    }
  }, exceptions: class {
    constructor(e2) {
      var t2, r2;
      this._suppressionRules = [], this._errorPropertiesBuilder = new Zi([new cr(), new br(), new _r(), new dr(), new mr(), new fr(), new pr(), new yr()], function(e3) {
        for (var t3 = arguments.length, r3 = new Array(t3 > 1 ? t3 - 1 : 0), s2 = 1; t3 > s2; s2++) r3[s2 - 1] = arguments[s2];
        return function(t4, s3) {
          void 0 === s3 && (s3 = 0);
          for (var n2 = [], o2 = t4.split("\n"), a2 = s3; o2.length > a2; a2++) {
            var l2 = o2[a2];
            if (1024 >= l2.length) {
              var u2 = ur.test(l2) ? l2.replace(ur, "$1") : l2;
              if (!u2.match(/\S*Error: /)) {
                for (var c2 of r3) {
                  var d2 = c2(u2, e3);
                  if (d2) {
                    n2.push(d2);
                    break;
                  }
                }
                if (n2.length >= 50) break;
              }
            }
          }
          return function(e4) {
            if (!e4.length) return [];
            var t5 = Array.from(e4);
            return t5.reverse(), t5.slice(0, 50).map((e5) => {
              return i({}, e5, { filename: e5.filename || (r4 = t5, r4[r4.length - 1] || {}).filename, function: e5.function || Xi });
              var r4;
            });
          }(n2);
        };
      }("web:javascript", nr, lr)), this._instance = e2, this._suppressionRules = null !== (t2 = null == (r2 = this._instance.persistence) ? void 0 : r2.get_property(g)) && void 0 !== t2 ? t2 : [], this._exceptionStepsConfig = kr(this._getExceptionStepsConfig()), this._exceptionStepsBuffer = new Pr(this._exceptionStepsConfig);
    }
    onConfigChange() {
      this._exceptionStepsConfig = kr(this._getExceptionStepsConfig()), this._exceptionStepsBuffer.setConfig(this._exceptionStepsConfig);
    }
    onRemoteConfig(e2) {
      var t2, i2, r2;
      if (e2.ok) {
        var s2 = e2.config;
        if ("errorTracking" in s2) {
          var n2 = null !== (t2 = null == (i2 = s2.errorTracking) ? void 0 : i2.suppressionRules) && void 0 !== t2 ? t2 : [], o2 = null == (r2 = s2.errorTracking) ? void 0 : r2.captureExtensionExceptions;
          this._suppressionRules = n2, this._instance.persistence && this._instance.persistence.register({ [g]: this._suppressionRules, [v]: o2 });
        }
      }
    }
    get _captureExtensionExceptions() {
      var e2, t2 = !!this._instance.get_property(v), i2 = this._instance.config.error_tracking.captureExtensionExceptions;
      return null !== (e2 = null != i2 ? i2 : t2) && void 0 !== e2 && e2;
    }
    buildProperties(e2, t2) {
      return this._errorPropertiesBuilder.buildFromUnknown(e2, { syntheticException: null == t2 ? void 0 : t2.syntheticException, mechanism: { handled: null == t2 ? void 0 : t2.handled } });
    }
    addExceptionStep(e2, t2) {
      if (this._exceptionStepsConfig.enabled) try {
        if (!ut(e2) || 0 === e2.trim().length) return void xl.warn("Ignoring exception step because message must be a non-empty string");
        var r2 = function(e3) {
          if (!e3) return { sanitizedProperties: {}, droppedKeys: [] };
          var t3 = [];
          return { sanitizedProperties: Object.keys(e3).reduce((i2, r3) => Er.has(r3) ? (t3.push(r3), i2) : (i2[r3] = e3[r3], i2), {}), droppedKeys: t3 };
        }(this._coerceExceptionStepProperties(t2)), s2 = r2.sanitizedProperties, n2 = r2.droppedKeys;
        n2.length > 0 && xl.warn("Ignoring reserved exception step fields", { droppedKeys: n2 }), this._exceptionStepsBuffer.add(i({ [wr]: e2, [Sr]: (/* @__PURE__ */ new Date()).toISOString() }, s2));
      } catch (e3) {
        xl.error("Failed to add exception step. Ignoring breadcrumb.", e3);
      }
    }
    sendExceptionEvent(e2) {
      try {
        var t2 = e2.$exception_list;
        if (this._isExceptionList(t2)) {
          if (this._matchesSuppressionRule(t2)) return this._addDroppedExceptionStep("Exception dropped: matched a suppression rule"), void xl.info("Skipping exception capture because a suppression rule matched");
          if (!this._captureExtensionExceptions && this._isExtensionException(t2)) return this._addDroppedExceptionStep("Exception dropped: thrown by a browser extension"), void xl.info("Skipping exception capture because it was thrown by an extension");
          if (!this._instance.config.error_tracking.__capturePostHogExceptions && this._isPostHogException(t2)) return this._addDroppedExceptionStep("Exception dropped: thrown by the PostHog SDK"), void xl.info("Skipping exception capture because it was thrown by the PostHog SDK");
        }
        var i2 = this._exceptionStepsConfig.enabled && _t(e2.$exception_steps) ? this._addBufferedExceptionSteps(e2) : e2;
        try {
          var r2 = this._instance.capture("$exception", i2, { _noTruncate: true, _batchKey: "exceptionEvent", _originatedFromCaptureException: true });
          return r2 && this._exceptionStepsBuffer.clear(), r2;
        } catch (e3) {
          return xl.error("Failed to capture exception event. Dropping this exception.", e3), void this._exceptionStepsBuffer.clear();
        }
      } catch (e3) {
        return void xl.error("Failed to process exception event. Ignoring this exception.", e3);
      }
    }
    _addBufferedExceptionSteps(e2) {
      try {
        var t2 = this._exceptionStepsBuffer.getAttachable();
        return 0 === t2.length ? e2 : i({}, e2, { $exception_steps: t2 });
      } catch (t3) {
        return xl.error("Failed to read buffered exception steps. Capturing exception without steps.", t3), e2;
      }
    }
    _addDroppedExceptionStep(e2) {
      this._exceptionStepsConfig.enabled && this._exceptionStepsBuffer.add({ [wr]: e2, [Sr]: (/* @__PURE__ */ new Date()).toISOString() });
    }
    _coerceExceptionStepProperties(e2) {
      return ot(e2) ? i({}, e2) : {};
    }
    _getExceptionStepsConfig() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this._instance.config.error_tracking) ? void 0 : t2.exception_steps) && void 0 !== e2 ? e2 : {};
    }
    _matchesSuppressionRule(e2) {
      if (0 === e2.length) return false;
      var t2 = e2.reduce((e3, t3) => {
        var i2 = t3.type, r2 = t3.value;
        return ut(i2) && i2.length > 0 && e3.$exception_types.push(i2), ut(r2) && r2.length > 0 && e3.$exception_values.push(r2), e3;
      }, { $exception_types: [], $exception_values: [] });
      return this._suppressionRules.some((e3) => {
        var i2 = e3.values.map((e4) => {
          var i3, r2 = ua[e4.operator], s2 = st(e4.value) ? e4.value : [e4.value], n2 = null !== (i3 = t2[e4.key]) && void 0 !== i3 ? i3 : [];
          return s2.length > 0 && r2(s2, n2);
        });
        return "OR" === e3.type ? i2.some(Boolean) : i2.every(Boolean);
      });
    }
    _isExtensionException(e2) {
      return e2.flatMap((e3) => {
        var t2, i2;
        return null !== (t2 = null == (i2 = e3.stacktrace) ? void 0 : i2.frames) && void 0 !== t2 ? t2 : [];
      }).some((e3) => e3.filename && e3.filename.startsWith("chrome-extension://"));
    }
    _isPostHogException(e2) {
      if (e2.length > 0) {
        var t2, i2, r2, s2, n2 = null !== (t2 = null == (i2 = e2[0].stacktrace) ? void 0 : i2.frames) && void 0 !== t2 ? t2 : [], o2 = n2[n2.length - 1];
        return null !== (r2 = null == o2 || null == (s2 = o2.filename) ? void 0 : s2.includes("posthog.com/static")) && void 0 !== r2 && r2;
      }
      return false;
    }
    _isExceptionList(e2) {
      return !_t(e2) && st(e2);
    }
  } };
  var $l = i({ productTours: class {
    get _persistence() {
      return this._instance.persistence;
    }
    constructor(e2) {
      this._productTourManager = null, this._cachedTours = null, this._instance = e2;
    }
    initialize() {
      this.loadIfEnabled();
    }
    onRemoteConfig(e2) {
      if (e2.ok) {
        var t2 = e2.config;
        if ("productTours" in t2) {
          var i2, r2;
          if (this._persistence && this._persistence.register({ [y]: !!t2.productTours }), !ol(this._instance)) return !this._productTourManager && _t(null == (i2 = this._persistence) ? void 0 : i2.props[V]) || nl.info("product tours disabled; stopping and clearing cached tours"), null == (r2 = this._productTourManager) || r2.stop(), this._productTourManager = null, void this.clearCache();
          this.loadIfEnabled();
        }
      }
    }
    loadIfEnabled() {
      !this._productTourManager && ol(this._instance) && this._loadScript(() => this._startProductTours());
    }
    _loadScript(e2) {
      var t2, i2;
      null != (t2 = Le.__PosthogExtensions__) && t2.generateProductTours ? e2() : null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, "product-tours", (t3) => {
        t3 ? nl.error("Could not load product tours script", t3) : e2();
      });
    }
    _startProductTours() {
      var e2;
      !this._productTourManager && null != (e2 = Le.__PosthogExtensions__) && e2.generateProductTours && (this._productTourManager = Le.__PosthogExtensions__.generateProductTours(this._instance, true));
    }
    getProductTours(e2, t2) {
      if (void 0 === t2 && (t2 = false), !st(this._cachedTours) || t2) {
        var i2 = this._persistence;
        if (i2) {
          var r2 = i2.props[V];
          if (st(r2) && !t2) return this._cachedTours = r2, void e2(r2, { isLoaded: true });
        }
        this._instance._send_request({ url: this._instance.requestRouter.endpointFor("api", "/api/product_tours/?token=" + this._instance.config.token), method: "GET", timestampMode: "query", callback: (t3) => {
          if (ol(this._instance)) {
            var r3 = t3.statusCode;
            if (200 !== r3 || !t3.json) {
              var s2 = "Product Tours API could not be loaded, status: " + r3;
              return nl.error(s2), void e2([], { isLoaded: false, error: s2 });
            }
            var n2 = st(t3.json.product_tours) ? t3.json.product_tours : [];
            this._cachedTours = n2, i2 && i2.register({ [V]: n2 }), e2(n2, { isLoaded: true });
          } else e2([], { isLoaded: true });
        } });
      } else e2(this._cachedTours, { isLoaded: true });
    }
    getActiveProductTours(e2) {
      _t(this._productTourManager) ? e2([], { isLoaded: false, error: "Product tours not loaded" }) : this._productTourManager.getActiveProductTours(e2);
    }
    showProductTour(e2) {
      var t2;
      null == (t2 = this._productTourManager) || t2.showTourById(e2);
    }
    previewTour(e2) {
      this._productTourManager ? this._productTourManager.previewTour(e2) : this._loadScript(() => {
        var t2;
        this._startProductTours(), null == (t2 = this._productTourManager) || t2.previewTour(e2);
      });
    }
    dismissProductTour() {
      var e2;
      null == (e2 = this._productTourManager) || e2.dismissTour("user_clicked_skip");
    }
    nextStep() {
      var e2;
      null == (e2 = this._productTourManager) || e2.nextStep();
    }
    previousStep() {
      var e2;
      null == (e2 = this._productTourManager) || e2.previousStep();
    }
    clearCache() {
      var e2;
      this._cachedTours = null, null == (e2 = this._persistence) || e2.unregister(V);
    }
    resetTour(e2) {
      var t2;
      null == (t2 = this._productTourManager) || t2.resetTour(e2);
    }
    resetAllTours() {
      var e2;
      null == (e2 = this._productTourManager) || e2.resetAllTours();
    }
    cancelPendingTour(e2) {
      var t2;
      null == (t2 = this._productTourManager) || t2.cancelPendingTour(e2);
    }
  } }, Rl);
  var Ol = { siteApps: class {
    constructor(e2) {
      this._siteAppElementPatchCount = 0, this._instance = e2, this._bufferedInvocations = [], this.apps = {};
    }
    get isEnabled() {
      return !!this._instance.config.opt_in_site_apps;
    }
    _eventCollector(e2, t2) {
      if (t2) {
        var i2 = this.globalsForEvent(t2);
        this._bufferedInvocations.push(i2), this._bufferedInvocations.length > 1e3 && (this._bufferedInvocations = this._bufferedInvocations.slice(10));
      }
    }
    get siteAppLoaders() {
      var e2;
      return null == (e2 = Le._POSTHOG_REMOTE_CONFIG) || null == (e2 = e2[this._instance.config.token]) ? void 0 : e2.siteApps;
    }
    initialize() {
      if (this.isEnabled) {
        var e2 = this._instance._addCaptureHook(this._eventCollector.bind(this));
        this._stopBuffering = () => {
          e2(), this._bufferedInvocations = [], this._stopBuffering = void 0;
        };
      }
    }
    globalsForEvent(e2) {
      var t2, s2, n2, o2, a2, l2, u2;
      if (!e2) throw new Error("Event payload is required");
      var c2 = {}, d2 = this._instance.get_property("$groups") || [], _2 = this._instance.get_property("$stored_group_properties") || {};
      for (var h2 of Object.entries(_2)) {
        var p2 = h2[0];
        c2[p2] = { id: d2[p2], type: p2, properties: h2[1] };
      }
      var g2 = e2.$set_once, v2 = e2.$set;
      return { event: i({}, r(e2, al), { properties: i({}, e2.properties, v2 ? { $set: i({}, null !== (t2 = null == (s2 = e2.properties) ? void 0 : s2.$set) && void 0 !== t2 ? t2 : {}, v2) } : {}, g2 ? { $set_once: i({}, null !== (n2 = null == (o2 = e2.properties) ? void 0 : o2.$set_once) && void 0 !== n2 ? n2 : {}, g2) } : {}), elements_chain: null !== (a2 = null == (l2 = e2.properties) ? void 0 : l2.$elements_chain) && void 0 !== a2 ? a2 : "", distinct_id: null == (u2 = e2.properties) ? void 0 : u2.distinct_id }), person: { properties: this._instance.get_property("$stored_person_properties") }, groups: c2 };
    }
    _prepareElementForSiteApp(e2) {
      var t2, i2 = null == (t2 = e2.tagName) ? void 0 : t2.toLowerCase();
      return "style" === i2 && this._instance.config.prepare_external_dependency_stylesheet ? this._instance.config.prepare_external_dependency_stylesheet(e2) || (ll.error("prepare_external_dependency_stylesheet returned null"), null) : "script" === i2 && this._instance.config.prepare_external_dependency_script ? this._instance.config.prepare_external_dependency_script(e2) || (ll.error("prepare_external_dependency_script returned null"), null) : e2;
    }
    _patchSiteAppElementInsertionMethods() {
      var e2, t2, i2, r2, s2, n2, o2, a2;
      if (!this._instance.config.prepare_external_dependency_stylesheet && !this._instance.config.prepare_external_dependency_script) return () => {
      };
      var l2 = null == Ee ? void 0 : Ee.defaultView, u2 = null == l2 || null == (e2 = l2.Node) ? void 0 : e2.prototype;
      if (!l2 || !u2) return () => {
      };
      if (this._siteAppElementPatchCount++, this._restoreSiteAppElementPatches) return this._releaseSiteAppElementPatches();
      var c2 = [], d2 = this, _2 = /* @__PURE__ */ new WeakSet(), h2 = (e3, t3, i3) => {
        if (null != e3 && e3[t3]) {
          var r3 = e3[t3];
          e3[t3] = i3(r3), c2.push(() => {
            e3[t3] = r3;
          });
        }
      }, p2 = (e3) => {
        if (_2.has(e3)) return e3;
        var t3 = d2._prepareElementForSiteApp(e3);
        return t3 && _2.add(t3), t3;
      }, g2 = (e3) => e3.map((e4) => "string" == typeof e4 ? e4 : p2(e4)).filter((e4) => !dt(e4));
      return h2(u2, "appendChild", (e3) => function(t3) {
        var i3 = p2(t3);
        return i3 ? e3.call(this, i3) : t3;
      }), h2(u2, "insertBefore", (e3) => function(t3, i3) {
        var r3 = p2(t3);
        return r3 ? e3.call(this, r3, i3) : t3;
      }), h2(u2, "replaceChild", (e3) => function(t3, i3) {
        var r3 = p2(t3);
        return r3 ? e3.call(this, r3, i3) : i3;
      }), [null == (t2 = l2.Element) ? void 0 : t2.prototype, null == (i2 = l2.Document) ? void 0 : i2.prototype, null == (r2 = l2.DocumentFragment) ? void 0 : r2.prototype].forEach((e3) => {
        h2(e3, "append", (e4) => function() {
          for (var t3 = arguments.length, i3 = new Array(t3), r3 = 0; t3 > r3; r3++) i3[r3] = arguments[r3];
          return e4.apply(this, g2(i3));
        }), h2(e3, "prepend", (e4) => function() {
          for (var t3 = arguments.length, i3 = new Array(t3), r3 = 0; t3 > r3; r3++) i3[r3] = arguments[r3];
          return e4.apply(this, g2(i3));
        });
      }), [null == (s2 = l2.Element) ? void 0 : s2.prototype, null == (n2 = l2.CharacterData) ? void 0 : n2.prototype, null == (o2 = l2.DocumentType) ? void 0 : o2.prototype].forEach((e3) => {
        h2(e3, "before", (e4) => function() {
          for (var t3 = arguments.length, i3 = new Array(t3), r3 = 0; t3 > r3; r3++) i3[r3] = arguments[r3];
          return e4.apply(this, g2(i3));
        }), h2(e3, "after", (e4) => function() {
          for (var t3 = arguments.length, i3 = new Array(t3), r3 = 0; t3 > r3; r3++) i3[r3] = arguments[r3];
          return e4.apply(this, g2(i3));
        }), h2(e3, "replaceWith", (e4) => function() {
          for (var t3 = arguments.length, i3 = new Array(t3), r3 = 0; t3 > r3; r3++) i3[r3] = arguments[r3];
          var s3 = g2(i3);
          return i3.length && !s3.length ? void 0 : e4.apply(this, s3);
        });
      }), h2(null == (a2 = l2.Element) ? void 0 : a2.prototype, "insertAdjacentElement", (e3) => function(t3, i3) {
        var r3 = p2(i3);
        return r3 ? e3.call(this, t3, r3) : null;
      }), this._restoreSiteAppElementPatches = () => {
        c2.forEach((e3) => e3()), this._restoreSiteAppElementPatches = void 0;
      }, this._releaseSiteAppElementPatches();
    }
    _releaseSiteAppElementPatches() {
      var e2 = false;
      return () => {
        var t2;
        e2 || (e2 = true, this._siteAppElementPatchCount--, 0 === this._siteAppElementPatchCount && (null == (t2 = this._restoreSiteAppElementPatches) || t2.call(this)));
      };
    }
    _runWithPreparedSiteAppElements(e2, t2) {
      void 0 === t2 && (t2 = true);
      var i2 = this._patchSiteAppElementInsertionMethods();
      try {
        var r2 = e2(i2);
        return t2 && i2(), r2;
      } catch (e3) {
        throw i2(), e3;
      }
    }
    setupSiteApp(e2) {
      var t2 = this.apps[e2.id], i2 = () => {
        var i3;
        !t2.errored && this._bufferedInvocations.length && (ll.info("Processing " + this._bufferedInvocations.length + " events for site app with id " + e2.id), this._bufferedInvocations.forEach((e3) => this._runWithPreparedSiteAppElements(() => null == t2.processEvent ? void 0 : t2.processEvent(e3))), t2.processedBuffer = true), Object.values(this.apps).every((e3) => e3.processedBuffer || e3.errored) && (null == (i3 = this._stopBuffering) || i3.call(this));
      }, r2 = false, s2 = (s3) => {
        t2.errored = !s3, t2.loaded = true, ll.info("Site app with id " + e2.id + " " + (s3 ? "loaded" : "errored")), r2 && i2();
      };
      try {
        var n2 = this._runWithPreparedSiteAppElements((t3) => e2.init({ posthog: this._instance, callback(e3) {
          t3(), s2(e3);
        } }), false).processEvent;
        n2 && (t2.processEvent = n2), r2 = true;
      } catch (t3) {
        ll.error(ul + e2.id, t3), s2(false);
      }
      if (r2 && t2.loaded) try {
        i2();
      } catch (i3) {
        ll.error("Error while processing buffered events PostHog app with config id " + e2.id, i3), t2.errored = true;
      }
    }
    _setupSiteApps() {
      var e2 = this.siteAppLoaders || [];
      for (var t2 of e2) this.apps[t2.id] = { id: t2.id, loaded: false, errored: false, processedBuffer: false };
      for (var i2 of e2) this.setupSiteApp(i2);
    }
    _onCapturedEvent(e2) {
      var t2 = this;
      if (0 !== Object.keys(this.apps).length) {
        var i2 = this.globalsForEvent(e2), r2 = function(r3) {
          try {
            t2._runWithPreparedSiteAppElements(() => null == r3.processEvent ? void 0 : r3.processEvent(i2));
          } catch (t3) {
            ll.error("Error while processing event " + e2.event + " for site app " + r3.id, t3);
          }
        };
        for (var s2 of Object.values(this.apps)) r2(s2);
      }
    }
    onRemoteConfig(e2) {
      var t2, i2, r2, s2 = this;
      if (null != (t2 = this.siteAppLoaders) && t2.length) return this.isEnabled ? (this._setupSiteApps(), void this._instance.on("eventCaptured", (e3) => this._onCapturedEvent(e3))) : void ll.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.');
      if (null == (i2 = this._stopBuffering) || i2.call(this), e2.ok) {
        var n2 = e2.config;
        if (null != (r2 = n2.siteApps) && r2.length) if (this.isEnabled) {
          var o2 = function() {
            var e3, t3 = a2.id, i3 = a2.url;
            Le["__$$ph_site_app_" + t3] = s2._instance, null == (e3 = Le.__PosthogExtensions__) || null == e3.loadSiteApp || e3.loadSiteApp(s2._instance, i3, (e4) => {
              if (e4) return ll.error(ul + t3, e4);
            });
          };
          for (var a2 of n2.siteApps) o2();
        } else ll.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.');
      }
    }
  } };
  var Dl = { tracingHeaders: class {
    constructor(e2) {
      this._restoreXHRPatch = void 0, this._restoreFetchPatch = void 0, this._hostnamesForPatch = void 0, this._startCapturing = () => {
        var e3, t2, i2 = this._syncHostnamesForPatch();
        i2 ? (lt(this._restoreXHRPatch) && (this._restoreXHRPatch = null == (e3 = Le.__PosthogExtensions__) || null == (e3 = e3.tracingHeadersPatchFns) ? void 0 : e3._patchXHR(i2, () => this._instance.get_distinct_id(), this._instance.sessionManager)), lt(this._restoreFetchPatch) && (this._restoreFetchPatch = null == (t2 = Le.__PosthogExtensions__) || null == (t2 = t2.tracingHeadersPatchFns) ? void 0 : t2._patchFetch(i2, () => this._instance.get_distinct_id(), this._instance.sessionManager))) : this._stopCapturing();
      }, this._instance = e2;
    }
    initialize() {
      this.startIfEnabledOrStop();
    }
    _loadScript(e2) {
      var t2, i2;
      null != (t2 = Le.__PosthogExtensions__) && t2.tracingHeadersPatchFns ? e2() : null == (i2 = Le.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, "tracing-headers", (t3) => {
        if (t3) return Ka.error("failed to load script", t3);
        e2();
      });
    }
    _getConfiguredHostnames() {
      var e2, t2;
      return null !== (e2 = null !== (t2 = this._instance.config.tracing_headers) && void 0 !== t2 ? t2 : this._instance.config.addTracingHeaders) && void 0 !== e2 ? e2 : this._instance.config.__add_tracing_headers;
    }
    _syncHostnamesForPatch() {
      var e2 = this._getConfiguredHostnames();
      return st(e2) ? (st(this._hostnamesForPatch) ? this._hostnamesForPatch.splice(0, this._hostnamesForPatch.length, ...e2) : this._hostnamesForPatch = [...e2], e2.length > 0 ? this._hostnamesForPatch : void 0) : (st(this._hostnamesForPatch) && this._hostnamesForPatch.splice(0), this._hostnamesForPatch = e2 || void 0, this._hostnamesForPatch);
    }
    _stopCapturing() {
      var e2, t2;
      null == (e2 = this._restoreXHRPatch) || e2.call(this), null == (t2 = this._restoreFetchPatch) || t2.call(this), this._restoreXHRPatch = void 0, this._restoreFetchPatch = void 0;
    }
    startIfEnabledOrStop() {
      this._syncHostnamesForPatch() ? this._loadScript(this._startCapturing) : this._stopCapturing();
    }
  } };
  var Nl = i({ surveys: class {
    get _config() {
      return this._instance.config;
    }
    constructor(e2) {
      this._isSurveysEnabled = void 0, this._surveyManager = null, this._isInitializingSurveys = false, this._surveyCallbacks = [], this._getSurveysInFlightPromise = null, this._lastSurveyRefreshFailedAt = null, this._instance = e2, this._surveyEventReceiver = null;
    }
    initialize() {
      this.loadIfEnabled();
    }
    onRemoteConfig(e2) {
      if (!this._config.disable_surveys) {
        if (!e2.ok) return fa.warn("Remote config unavailable. Not loading surveys.");
        var t2 = e2.config.surveys;
        if (_t(t2)) return fa.warn("Flags not loaded yet. Not loading surveys.");
        var i2 = st(t2);
        this._isSurveysEnabled = i2 ? t2.length > 0 : t2, fa.info("flags response received, isSurveysEnabled: " + this._isSurveysEnabled), this.loadIfEnabled();
      }
    }
    reset() {
      try {
        var e2;
        null == (e2 = this._surveyEventReceiver) || e2.reset(), localStorage.removeItem("lastSeenSurveyDate");
        for (var t2 = [], i2 = 0; i2 < localStorage.length; i2++) {
          var r2 = localStorage.key(i2);
          (null != r2 && r2.startsWith(ma) || null != r2 && r2.startsWith("inProgressSurvey_")) && t2.push(r2);
        }
        t2.forEach((e3) => localStorage.removeItem(e3));
      } catch (e3) {
      }
    }
    loadIfEnabled() {
      if (!this._surveyManager) if (this._isInitializingSurveys) fa.info("Already initializing surveys, skipping...");
      else if (this._config.disable_surveys) fa.info(gl);
      else if (this._config.cookieless_mode && this._instance.consent.isOptedOut()) fa.info("Not loading surveys in cookieless mode without consent.");
      else {
        var e2 = null == Le ? void 0 : Le.__PosthogExtensions__;
        if (e2) {
          if (!lt(this._isSurveysEnabled) || this._config.advanced_enable_surveys) {
            var t2 = this._isSurveysEnabled || this._config.advanced_enable_surveys;
            this._isInitializingSurveys = true;
            try {
              var i2 = e2.generateSurveys;
              if (i2) return void this._completeSurveyInitialization(i2, t2);
              var r2 = e2.loadExternalDependency;
              if (!r2) return void this._handleSurveyLoadError(le);
              r2(this._instance, "surveys", (i3) => {
                i3 || !e2.generateSurveys ? this._handleSurveyLoadError("Could not load surveys script", i3) : this._completeSurveyInitialization(e2.generateSurveys, t2);
              });
            } catch (e3) {
              throw this._handleSurveyLoadError("Error initializing surveys", e3), e3;
            } finally {
              this._isInitializingSurveys = false;
            }
          }
        } else fa.error("PostHog Extensions not found.");
      }
    }
    _completeSurveyInitialization(e2, t2) {
      this._surveyManager = e2(this._instance, t2), this._surveyEventReceiver = new hl(this._instance), fa.info("Surveys loaded successfully"), this._notifySurveyCallbacks({ isLoaded: true });
    }
    _handleSurveyLoadError(e2, t2) {
      fa.error(e2, t2), this._notifySurveyCallbacks({ isLoaded: false, error: e2 });
    }
    onSurveysLoaded(e2) {
      return this._surveyCallbacks.push(e2), this._surveyManager && this._notifySurveyCallbacks({ isLoaded: true }), () => {
        this._surveyCallbacks = this._surveyCallbacks.filter((t2) => t2 !== e2);
      };
    }
    getSurveys(e2, t2) {
      if (void 0 === t2 && (t2 = false), this._config.disable_surveys) return fa.info(gl), e2([]);
      var i2, r2 = this._instance.get_property(U);
      if (r2 && !t2) return e2(r2, { isLoaded: true }), void (this._shouldBackgroundRefreshSurveys() && this.getSurveys(() => {
      }, true));
      "undefined" != typeof Promise && this._getSurveysInFlightPromise ? this._getSurveysInFlightPromise.then((t3) => e2(t3.surveys, t3.context)) : ("undefined" != typeof Promise && (this._getSurveysInFlightPromise = new Promise((e3) => {
        i2 = e3;
      })), this._instance._send_request({ url: this._instance.requestRouter.endpointFor("api", "/api/surveys/?token=" + this._config.token), method: "GET", timestampMode: "query", timeout: this._config.surveys_request_timeout_ms, callback: (t3) => {
        var r3;
        this._getSurveysInFlightPromise = null;
        var s2 = t3.statusCode;
        if (200 !== s2 || !t3.json) {
          var n2 = "Surveys API could not be loaded, status: " + s2;
          fa.error(n2), this._lastSurveyRefreshFailedAt = Date.now();
          var o2 = { isLoaded: false, error: n2 };
          return e2([], o2), void (null == i2 || i2({ surveys: [], context: o2 }));
        }
        this._lastSurveyRefreshFailedAt = null;
        var a2, l2 = t3.json.surveys || [], u2 = l2.filter((e3) => function(e4) {
          return !(!e4.start_date || e4.end_date);
        }(e3) && (va(e3) || function(e4) {
          var t4;
          return !(null == (t4 = e4.conditions) || null == (t4 = t4.actions) || null == (t4 = t4.values) || !t4.length);
        }(e3)));
        u2.length > 0 && (null == (a2 = this._surveyEventReceiver) || a2.register(u2)), null == (r3 = this._instance.persistence) || r3.register({ [U]: l2, [H]: Date.now() });
        var c2 = { isLoaded: true };
        e2(l2, c2), null == i2 || i2({ surveys: l2, context: c2 });
      } }));
    }
    _shouldBackgroundRefreshSurveys() {
      return this._isSurveyCacheStale() && !this._getSurveysInFlightPromise && !this._isSurveyRefreshBackingOff();
    }
    _isSurveyCacheStale() {
      var e2 = this._instance.get_property(H);
      return ht(e2) && Date.now() - e2 > 3e5;
    }
    _isSurveyRefreshBackingOff() {
      return ht(this._lastSurveyRefreshFailedAt) && 3e5 > Date.now() - this._lastSurveyRefreshFailedAt;
    }
    markSurveyAsSeen(e2, t2) {
      var i2, r2 = { id: e2, current_iteration: null !== (i2 = null == t2 ? void 0 : t2.iteration) && void 0 !== i2 ? i2 : null };
      ya(r2);
      try {
        localStorage.setItem("lastSeenSurveyDate", (/* @__PURE__ */ new Date()).toISOString());
      } catch (e3) {
      }
    }
    _notifySurveyCallbacks(e2) {
      for (var t2 of this._surveyCallbacks) try {
        if (!e2.isLoaded) return t2([], e2);
        this.getSurveys(t2);
      } catch (e3) {
        fa.error("Error in survey callback", e3);
      }
    }
    getActiveMatchingSurveys(e2, t2) {
      if (void 0 === t2 && (t2 = false), !_t(this._surveyManager)) return this._surveyManager.getActiveMatchingSurveys(e2, t2);
      fa.warn("init was not called");
    }
    _getSurveyById(e2) {
      var t2 = null;
      return this.getSurveys((i2) => {
        var r2;
        t2 = null !== (r2 = i2.find((t3) => t3.id === e2)) && void 0 !== r2 ? r2 : null;
      }), t2;
    }
    _checkSurveyEligibility(e2) {
      if (_t(this._surveyManager)) return { eligible: false, reason: pl };
      var t2 = "string" == typeof e2 ? this._getSurveyById(e2) : e2;
      return t2 ? this._surveyManager.checkSurveyEligibility(t2) : { eligible: false, reason: "Survey not found" };
    }
    canRenderSurvey(e2) {
      if (_t(this._surveyManager)) return fa.warn("init was not called"), { visible: false, disabledReason: pl };
      var t2 = this._checkSurveyEligibility(e2);
      return { visible: t2.eligible, disabledReason: t2.reason };
    }
    canRenderSurveyAsync(e2, t2) {
      return _t(this._surveyManager) ? (fa.warn("init was not called"), Promise.resolve({ visible: false, disabledReason: pl })) : new Promise((i2) => {
        this.getSurveys((t3) => {
          var r2, s2 = null !== (r2 = t3.find((t4) => t4.id === e2)) && void 0 !== r2 ? r2 : null;
          if (s2) {
            var n2 = this._checkSurveyEligibility(s2);
            i2({ visible: n2.eligible, disabledReason: n2.reason });
          } else i2({ visible: false, disabledReason: "Survey not found" });
        }, t2);
      });
    }
    renderSurvey(e2, t2, i2) {
      var r2;
      if (_t(this._surveyManager)) fa.warn("init was not called");
      else {
        var s2 = "string" == typeof e2 ? this._getSurveyById(e2) : e2;
        if (null != s2 && s2.id) if (ba.includes(s2.type)) {
          var n2 = null == Ee ? void 0 : Ee.querySelector(t2);
          if (n2) return null != (r2 = s2.appearance) && r2.surveyPopupDelaySeconds ? (fa.info("Rendering survey " + s2.id + " with delay of " + s2.appearance.surveyPopupDelaySeconds + " seconds"), void setTimeout(() => {
            var e3, t3;
            fa.info("Rendering survey " + s2.id + " with delay of " + (null == (e3 = s2.appearance) ? void 0 : e3.surveyPopupDelaySeconds) + " seconds"), null == (t3 = this._surveyManager) || t3.renderSurvey(s2, n2, i2), fa.info("Survey " + s2.id + " rendered");
          }, 1e3 * s2.appearance.surveyPopupDelaySeconds)) : void this._surveyManager.renderSurvey(s2, n2, i2);
          fa.warn("Survey element not found");
        } else fa.warn("Surveys of type " + s2.type + " cannot be rendered in the app");
        else fa.warn("Survey not found");
      }
    }
    displaySurvey(e2, t2) {
      var r2;
      if (_t(this._surveyManager)) fa.warn("init was not called");
      else {
        var s2 = this._getSurveyById(e2);
        if (s2) {
          var n2 = s2;
          if (null != (r2 = s2.appearance) && r2.surveyPopupDelaySeconds && t2.ignoreDelay && (n2 = i({}, s2, { appearance: i({}, s2.appearance, { surveyPopupDelaySeconds: 0 }) })), t2.displayType !== Vn.Popover && t2.initialResponses && fa.warn("initialResponses is only supported for popover surveys. prefill will not be applied."), false === t2.ignoreConditions) {
            var o2 = this.canRenderSurvey(s2);
            if (!o2.visible) return void fa.warn("Survey is not eligible to be displayed: ", o2.disabledReason);
          }
          t2.displayType !== Vn.Inline ? this._surveyManager.handlePopoverSurvey(n2, t2) : this.renderSurvey(n2, t2.selector, t2.properties);
        } else fa.warn("Survey not found");
      }
    }
    cancelPendingSurvey(e2) {
      _t(this._surveyManager) ? fa.warn("init was not called") : this._surveyManager.cancelSurvey(e2);
    }
    handlePageUnload() {
      var e2;
      null == (e2 = this._surveyManager) || null == e2.handlePageUnload || e2.handlePageUnload();
    }
  } }, Rl);
  var Bl = { toolbar: class {
    constructor(e2) {
      this.instance = e2;
    }
    _setToolbarState(e2) {
      Le.ph_toolbar_state = e2;
    }
    _getToolbarState() {
      var e2;
      return null !== (e2 = Le.ph_toolbar_state) && void 0 !== e2 ? e2 : 0;
    }
    initialize() {
      return this.maybeLoadToolbar();
    }
    maybeLoadToolbar(e2, t2, i2) {
      if (void 0 === e2 && (e2 = void 0), void 0 === t2 && (t2 = void 0), void 0 === i2 && (i2 = void 0), Ur(this.instance.config)) return false;
      if (!be || !Ee) return false;
      e2 = null != e2 ? e2 : be.location, i2 = null != i2 ? i2 : be.history;
      try {
        if (!t2) {
          try {
            be.localStorage.setItem("test", "test"), be.localStorage.removeItem("test");
          } catch (e3) {
            return false;
          }
          t2 = null == be ? void 0 : be.localStorage;
        }
        var r2, s2 = vl || hn(e2.hash, "__posthog") || hn(e2.hash, "state"), n2 = s2 ? $r(() => JSON.parse(atob(decodeURIComponent(s2)))) || $r(() => JSON.parse(decodeURIComponent(s2))) : null;
        return n2 && "ph_authorize" === n2.action ? ((r2 = n2).source = "url", r2 && Object.keys(r2).length > 0 && (n2.desiredHash ? e2.hash = n2.desiredHash : i2 ? i2.replaceState(i2.state, "", e2.pathname + e2.search) : e2.hash = "")) : ((r2 = JSON.parse(t2.getItem(fl) || "{}")).source = "localstorage", delete r2.userIntent), !(!r2.token || this.instance.config.token !== r2.token || (this.loadToolbar(r2), 0));
      } catch (e3) {
        return false;
      }
    }
    _callLoadToolbar(e2) {
      var t2 = Le.ph_load_toolbar || Le.ph_load_editor;
      !_t(t2) && nt(t2) ? t2(e2, this.instance) : ml.warn("No toolbar load function found");
    }
    loadToolbar(e2) {
      var t2 = !(null == Ee || !Ee.getElementById(ls));
      if (!be || t2) return false;
      var r2 = "custom" === this.instance.requestRouter.region && this.instance.config.advanced_disable_toolbar_metrics, s2 = i({ token: this.instance.config.token }, e2, { apiURL: this.instance.requestRouter.endpointFor("ui") }, r2 ? { instrument: false } : {});
      if (be.localStorage.setItem(fl, JSON.stringify(i({}, s2, { source: void 0 }))), 2 === this._getToolbarState()) this._callLoadToolbar(s2);
      else if (0 === this._getToolbarState()) {
        var n2;
        this._setToolbarState(1), null == (n2 = Le.__PosthogExtensions__) || null == n2.loadExternalDependency || n2.loadExternalDependency(this.instance, "toolbar", (e3) => {
          if (e3) return ml.error("[Toolbar] Failed to load", e3), void this._setToolbarState(0);
          this._setToolbarState(2), this._callLoadToolbar(s2);
        }), qr(be, "turbolinks:load", () => {
          this._setToolbarState(0), this.loadToolbar(s2);
        });
      }
      return true;
    }
    _loadEditor(e2) {
      return this.loadToolbar(e2);
    }
    maybeLoadEditor(e2, t2, i2) {
      return void 0 === e2 && (e2 = void 0), void 0 === t2 && (t2 = void 0), void 0 === i2 && (i2 = void 0), this.maybeLoadToolbar(e2, t2, i2);
    }
  } };
  var ql = i({ experiments: Il }, Rl);
  var Ul = { conversations: class {
    constructor(e2) {
      this._isConversationsEnabled = void 0, this._conversationsManager = null, this._isInitializing = false, this._remoteConfig = null, this._instance = e2;
    }
    initialize() {
      this.loadIfEnabled();
    }
    onRemoteConfig(e2) {
      if (!this._instance.config.disable_conversations && e2.ok) {
        var t2 = e2.config.conversations;
        _t(t2) || (gt(t2) ? this._isConversationsEnabled = t2 : (this._isConversationsEnabled = t2.enabled, this._remoteConfig = t2), this.loadIfEnabled());
      }
    }
    reset() {
      var e2;
      null == (e2 = this._conversationsManager) || e2.reset(), this._conversationsManager = null, this._isConversationsEnabled = void 0, this._remoteConfig = null;
    }
    loadIfEnabled() {
      if (!(this._conversationsManager || this._isInitializing || this._instance.config.disable_conversations || Ur(this._instance.config) || this._instance.config.cookieless_mode && this._instance.consent.isOptedOut())) {
        var e2 = null == Le ? void 0 : Le.__PosthogExtensions__;
        if (e2 && !lt(this._isConversationsEnabled) && this._isConversationsEnabled) if (this._remoteConfig && this._remoteConfig.token) {
          this._isInitializing = true;
          try {
            var t2 = e2.initConversations;
            if (t2) return this._completeInitialization(t2), void (this._isInitializing = false);
            var i2 = e2.loadExternalDependency;
            if (!i2) return void this._handleLoadError(le);
            i2(this._instance, "conversations", (t3) => {
              t3 || !e2.initConversations ? this._handleLoadError("Could not load conversations script", t3) : this._completeInitialization(e2.initConversations), this._isInitializing = false;
            });
          } catch (e3) {
            this._handleLoadError("Error initializing conversations", e3), this._isInitializing = false;
          }
        } else Cl.error("Conversations enabled but missing token in remote config.");
      }
    }
    _completeInitialization(e2) {
      if (this._remoteConfig) try {
        this._conversationsManager = e2(this._remoteConfig, this._instance), Cl.info("Conversations loaded successfully");
      } catch (e3) {
        this._handleLoadError("Error completing conversations initialization", e3);
      }
      else Cl.error("Cannot complete initialization: remote config is null");
    }
    _handleLoadError(e2, t2) {
      Cl.error(e2, t2), this._conversationsManager = null, this._isInitializing = false;
    }
    show() {
      this._conversationsManager ? this._conversationsManager.show() : Cl.warn("Conversations not loaded yet.");
    }
    hide() {
      this._conversationsManager && this._conversationsManager.hide();
    }
    isAvailable() {
      return true === this._isConversationsEnabled && !dt(this._conversationsManager);
    }
    isVisible() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this._conversationsManager) ? void 0 : t2.isVisible()) && void 0 !== e2 && e2;
    }
    sendMessage(e2, i2, r2) {
      var s2 = this;
      return t(function* () {
        return s2._conversationsManager ? s2._conversationsManager.sendMessage(e2, i2, r2) : (Cl.warn(Tl), null);
      })();
    }
    getMessages(e2, i2) {
      var r2 = this;
      return t(function* () {
        return r2._conversationsManager ? r2._conversationsManager.getMessages(e2, i2) : (Cl.warn(Tl), null);
      })();
    }
    markAsRead(e2) {
      var i2 = this;
      return t(function* () {
        return i2._conversationsManager ? i2._conversationsManager.markAsRead(e2) : (Cl.warn(Tl), null);
      })();
    }
    getTickets(e2) {
      var i2 = this;
      return t(function* () {
        return i2._conversationsManager ? i2._conversationsManager.getTickets(e2) : (Cl.warn(Tl), null);
      })();
    }
    requestRestoreLink(e2) {
      var i2 = this;
      return t(function* () {
        return i2._conversationsManager ? i2._conversationsManager.requestRestoreLink(e2) : (Cl.warn(Tl), null);
      })();
    }
    restoreFromToken(e2) {
      var i2 = this;
      return t(function* () {
        return i2._conversationsManager ? i2._conversationsManager.restoreFromToken(e2) : (Cl.warn(Tl), null);
      })();
    }
    restoreFromUrlToken() {
      var e2 = this;
      return t(function* () {
        return e2._conversationsManager ? e2._conversationsManager.restoreFromUrlToken() : (Cl.warn(Tl), null);
      })();
    }
    getCurrentTicketId() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this._conversationsManager) ? void 0 : t2.getCurrentTicketId()) && void 0 !== e2 ? e2 : null;
    }
    getWidgetSessionId() {
      var e2, t2;
      return null !== (e2 = null == (t2 = this._conversationsManager) ? void 0 : t2.getWidgetSessionId()) && void 0 !== e2 ? e2 : null;
    }
    _onIdentityChanged() {
      var e2;
      null == (e2 = this._conversationsManager) || e2.setIdentity();
    }
    _onIdentityCleared() {
      var e2;
      null == (e2 = this._conversationsManager) || e2.clearIdentity();
    }
  } };
  var Hl = { logs: class {
    constructor(e2) {
      var t2;
      this._isLogsEnabled = false, this._isLoaded = false, this._logger = Fr("[logs]"), this._queue = [], this._consoleQueue = [], this._consecutiveStatusZeroFailures = 0, this._onReconnect = () => {
        var e3, t3;
        this._consecutiveStatusZeroFailures = 0, null == (e3 = this._core) || e3.onReconnect(), null == (t3 = this._consoleCore) || t3.onReconnect();
      }, this._instance = e2, this._instance && null != (t2 = this._instance.config.logs) && t2.captureConsoleLogs && (this._isLogsEnabled = true), be && qr(be, "online", this._onReconnect);
    }
    _buildCore(e2, t2, i2, r2) {
      var s2, n2 = function(e3, t3) {
        var i3, r3, s3, n3, o2, a2, l2, u2 = null !== (i3 = null == e3 ? void 0 : e3.flushIntervalMs) && void 0 !== i3 ? i3 : 3e3, c2 = null !== (r3 = null == e3 ? void 0 : e3.maxBufferSize) && void 0 !== r3 ? r3 : 100, d2 = null != t3 && t3.consoleCapture ? void 0 : null !== (s3 = null == e3 ? void 0 : e3.maxLogsPerInterval) && void 0 !== s3 ? s3 : 1e3, _2 = lt(d2) ? Math.max(c2, 2048) : Math.max(c2, d2), h2 = null == e3 ? void 0 : e3.resourceAttributes;
        return { serviceName: null !== (n3 = null !== (o2 = null == h2 ? void 0 : h2["service.name"]) && void 0 !== o2 ? o2 : null == e3 ? void 0 : e3.serviceName) && void 0 !== n3 ? n3 : null == t3 ? void 0 : t3.serviceNameDefault, serviceVersion: null !== (a2 = null == h2 ? void 0 : h2["service.version"]) && void 0 !== a2 ? a2 : null == e3 ? void 0 : e3.serviceVersion, environment: null !== (l2 = null == h2 ? void 0 : h2["deployment.environment"]) && void 0 !== l2 ? l2 : null == e3 ? void 0 : e3.environment, resourceAttributes: h2, beforeSend: null == e3 ? void 0 : e3.beforeSend, flushIntervalMs: u2, maxBufferSize: c2, maxQueueSize: _2, maxBatchRecordsPerPost: 100, rateCapWindowMs: u2, maxLogsPerInterval: d2, backgroundFlushBudgetMs: 0, terminationFlushBudgetMs: 0 };
      }(null == (s2 = this._instance) || null == (s2 = s2.config) ? void 0 : s2.logs, i2);
      return [new zi(this._createHost(e2, t2), n2, this._logger, () => this._getSdkContext(), (e3) => e3(), void 0, r2), n2];
    }
    _getCore() {
      var e2, t2 = null == (e2 = this._instance) || null == (e2 = e2.config) ? void 0 : e2.logs;
      if (!this._core || this._resolvedFrom !== t2) {
        var i2;
        null == (i2 = this._core) || i2.reset(), this._resolvedFrom = t2;
        var r2 = this._buildCore(() => this._queue, (e3) => {
          this._queue = e3;
        });
        this._core = r2[0], this._resolvedConfig = r2[1];
      }
      return this._core;
    }
    _getConsoleCore() {
      var e2, t2 = null == (e2 = this._instance) || null == (e2 = e2.config) ? void 0 : e2.logs;
      if (!this._consoleCore || this._consoleResolvedFrom !== t2) {
        var i2;
        null == (i2 = this._consoleCore) || i2.reset(), this._consoleResolvedFrom = t2;
        var r2 = this._buildCore(() => this._consoleQueue, (e3) => {
          this._consoleQueue = e3;
        }, { serviceNameDefault: "posthog-browser-logs", consoleCapture: true }, Fl);
        this._consoleCore = r2[0], this._consoleResolvedConfig = r2[1];
      }
      return this._consoleCore;
    }
    initialize() {
      this.loadIfEnabled();
    }
    onRemoteConfig(e2) {
      var t2;
      if (e2.ok) {
        var i2 = null == (t2 = e2.config.logs) ? void 0 : t2.captureConsoleLogs;
        !_t(i2) && i2 && (this._isLogsEnabled = true, this.loadIfEnabled());
      }
    }
    reset() {
      var e2, t2;
      this._queue = [], null == (e2 = this._core) || e2.reset(), this._consoleQueue = [], null == (t2 = this._consoleCore) || t2.reset(), this._consecutiveStatusZeroFailures = 0;
    }
    captureLog(e2) {
      this._getCore().captureLog(e2);
    }
    _captureConsoleLog(e2) {
      this._getConsoleCore().captureLog(e2);
    }
    get logger() {
      return this._capture_logger || (this._capture_logger = { trace: (e2, t2) => this.captureLog({ body: e2, level: "trace", attributes: t2 }), debug: (e2, t2) => this.captureLog({ body: e2, level: "debug", attributes: t2 }), info: (e2, t2) => this.captureLog({ body: e2, level: "info", attributes: t2 }), warn: (e2, t2) => this.captureLog({ body: e2, level: "warn", attributes: t2 }), error: (e2, t2) => this.captureLog({ body: e2, level: "error", attributes: t2 }), fatal: (e2, t2) => this.captureLog({ body: e2, level: "fatal", attributes: t2 }) }), this._capture_logger;
    }
    flushLogs(e2) {
      e2 ? this._flushViaTransport(e2) : (this._core && this._core.flush().catch((e3) => this._logger.error("PostHog logs flush failed:", e3)), this._consoleCore && this._consoleCore.flush().catch((e3) => this._logger.error("PostHog logs flush failed:", e3)));
    }
    loadIfEnabled() {
      if (this._isLogsEnabled && !this._isLoaded) {
        var e2 = null == Le ? void 0 : Le.__PosthogExtensions__;
        if (e2) {
          var t2 = e2.loadExternalDependency;
          t2 ? t2(this._instance, "logs", (t3) => {
            var i2;
            t3 || null == (i2 = e2.logs) || !i2.initializeLogs ? this._logger.error("Could not load logs script", t3) : (e2.logs.initializeLogs(this._instance), this._isLoaded = true);
          }) : this._logger.error(le);
        } else this._logger.error("PostHog Extensions not found.");
      }
    }
    _createHost(e2, t2) {
      var i2 = this._instance;
      return { get isDisabled() {
        return false;
      }, get optedOut() {
        return !i2.is_capturing();
      }, getPersistedProperty: (t3) => t3 === Ne.LogsQueue ? e2() : void 0, setPersistedProperty(e3, i3) {
        var r2;
        e3 === Ne.LogsQueue && t2(null !== (r2 = i3) && void 0 !== r2 ? r2 : []);
      }, _sendLogsBatch: (e3) => this._sendLogsBatch(e3), getLibraryId: () => n.LIB_NAME, getLibraryVersion: () => n.LIB_VERSION };
    }
    _sendLogsBatch(e2) {
      return new Promise((t2) => {
        if (pn(this._consecutiveStatusZeroFailures, 3)) t2({ kind: "fatal", error: new Error("logs endpoint is unreachable, dropping batch") });
        else {
          var i2 = false, r2 = (e3) => {
            i2 || (i2 = true, clearTimeout(s2), t2(e3));
          }, s2 = setTimeout(() => r2({ kind: "retry-later", error: new Error("logs request timed out") }), 9e4);
          this._instance._send_request({ method: "POST", url: this._logsUrl(), data: e2, compression: "best-available", batchKey: "logs", fireCallbackOnDrop: true, callback: (e3) => {
            var t3 = e3.statusCode;
            if (this._trackEndpointReachability(t3), t3 >= 200 && 300 > t3) r2({ kind: "ok" });
            else if (413 === t3) r2({ kind: "too-large" });
            else if (0 !== t3 && 429 !== t3 && 500 > t3) r2({ kind: "fatal", error: new Error("logs request failed with status " + t3) });
            else {
              var i3;
              r2({ kind: "retry-later", error: null !== (i3 = e3.error) && void 0 !== i3 ? i3 : new Error("logs request failed with status " + t3) });
            }
          } });
        }
      });
    }
    _trackEndpointReachability(e2) {
      (0 !== e2 || this._instance.__loaded) && (this._consecutiveStatusZeroFailures = gn(e2, this._consecutiveStatusZeroFailures, 3, () => this._logger.warn("Log requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped sending logs; will try again when connectivity changes.")));
    }
    _flushViaTransport(e2) {
      this._queue.length > 0 && this._drainQueueViaTransport(e2, this._queue, this._resolvedConfig, n.LIB_NAME, (e3) => {
        this._queue = e3;
      }), this._consoleQueue.length > 0 && this._drainQueueViaTransport(e2, this._consoleQueue, this._consoleResolvedConfig, Fl, (e3) => {
        this._consoleQueue = e3;
      });
    }
    _drainQueueViaTransport(e2, t2, i2, r2, s2) {
      if (0 !== t2.length) {
        var o2 = t2.map((e3) => e3.record);
        s2([]);
        var a2 = Hi(o2, Ui(i2, n.LIB_NAME, n.LIB_VERSION), r2, n.LIB_VERSION);
        this._instance._send_request({ method: "POST", url: this._logsUrl(), data: a2, compression: "best-available", batchKey: "logs", transport: e2 });
      }
    }
    _logsUrl() {
      return this._instance.requestRouter.endpointFor("api", "/i/v1/logs") + "?token=" + encodeURIComponent(this._instance.config.token);
    }
    _getSdkContext() {
      var e2, t2 = {};
      if (t2.distinctId = this._instance.get_distinct_id(), this._instance.sessionManager) {
        var i2 = this._instance.sessionManager.checkAndGetSessionAndWindowId(true), r2 = i2.windowId, s2 = i2.sessionStartTimestamp, n2 = i2.lastActivityTimestamp;
        t2.sessionId = i2.sessionId, t2.windowId = r2, _t(s2) || (t2.sessionStartTimestamp = s2), _t(n2) || (t2.lastActivityTimestamp = n2);
      }
      if (null != Le && null != (e2 = Le.location) && e2.href && (t2.currentUrl = this._instance.config.disable_capture_url_hashes ? Mi(Le.location.href) : Le.location.href), this._instance.featureFlags) {
        var o2 = this._instance.featureFlags.getFlags();
        o2 && o2.length > 0 && (t2.activeFeatureFlags = o2);
      }
      return t2;
    }
  } };
  var zl = { metrics: class {
    constructor(e2) {
      this._logger = Fr("[metrics]"), this._instance = e2;
    }
    initialize() {
    }
    _getCore() {
      var e2, t2, i2 = null == (e2 = this._instance) || null == (e2 = e2.config) ? void 0 : e2.metrics;
      return this._core && this._resolvedFrom === i2 || (null == (t2 = this._core) || t2.reset(), this._resolvedFrom = i2, this._core = new Gi(this._createHost(), function(e3) {
        var t3, i3, r2, s2, n2, o2 = null == e3 ? void 0 : e3.resourceAttributes;
        return { serviceName: null !== (t3 = null == o2 ? void 0 : o2["service.name"]) && void 0 !== t3 ? t3 : null == e3 ? void 0 : e3.serviceName, serviceVersion: null !== (i3 = null == o2 ? void 0 : o2["service.version"]) && void 0 !== i3 ? i3 : null == e3 ? void 0 : e3.serviceVersion, environment: null !== (r2 = null == o2 ? void 0 : o2["deployment.environment"]) && void 0 !== r2 ? r2 : null == e3 ? void 0 : e3.environment, resourceAttributes: o2, beforeSend: null == e3 ? void 0 : e3.beforeSend, flushIntervalMs: null !== (s2 = null == e3 ? void 0 : e3.flushIntervalMs) && void 0 !== s2 ? s2 : 1e4, maxSeriesPerFlush: null !== (n2 = null == e3 ? void 0 : e3.maxSeriesPerFlush) && void 0 !== n2 ? n2 : 1e3 };
      }(i2), this._logger)), this._core;
    }
    count(e2, t2, i2) {
      void 0 === t2 && (t2 = 1), this._getCore().count(e2, t2, i2);
    }
    gauge(e2, t2, i2) {
      this._getCore().gauge(e2, t2, i2);
    }
    histogram(e2, t2, i2) {
      this._getCore().histogram(e2, t2, i2);
    }
    flush(e2) {
      if (!this._core) return Promise.resolve();
      if (e2) {
        var t2 = this._core.drainWindow();
        return t2 && this._sendMetricsBatch(t2, e2), Promise.resolve();
      }
      return this._core.flush().catch((e3) => this._logger.error("PostHog metrics flush failed:", e3));
    }
    reset() {
      var e2;
      null == (e2 = this._core) || e2.reset();
    }
    _createHost() {
      var e2 = this._instance, t2 = this;
      return { get isDisabled() {
        return false;
      }, get optedOut() {
        return !e2.is_capturing();
      }, _sendMetricsBatch: (e3) => t2._sendMetricsBatch(e3), getLibraryId: () => n.LIB_NAME, getLibraryVersion: () => n.LIB_VERSION };
    }
    _sendMetricsBatch(e2, t2) {
      return new Promise((r2) => {
        var s2 = false, n2 = (e3) => {
          s2 || (s2 = true, clearTimeout(o2), r2(e3));
        }, o2 = setTimeout(() => n2({ kind: "retry-later", error: new Error("metrics request timed out") }), 9e4);
        this._instance._send_request(i({ method: "POST", url: this._metricsUrl(), data: e2, compression: "best-available", batchKey: "metrics" }, t2 && { transport: t2 }, { fireCallbackOnDrop: true, callback(e3) {
          var t3 = e3.statusCode;
          if (t3 >= 200 && 300 > t3) n2({ kind: "ok" });
          else if (413 === t3) n2({ kind: "too-large" });
          else if (0 !== t3 && 429 !== t3 && 500 > t3) n2({ kind: "fatal", error: new Error("metrics request failed with status " + t3) });
          else {
            var i2;
            n2({ kind: "retry-later", error: null !== (i2 = e3.error) && void 0 !== i2 ? i2 : new Error("metrics request failed with status " + t3) });
          }
        } }));
      });
    }
    _metricsUrl() {
      return this._instance.requestRouter.endpointFor("api", "/i/v1/metrics") + "?token=" + encodeURIComponent(this._instance.config.token);
    }
  } };
  var jl = i({}, Rl, Ll, Ml, Al, $l, Ol, Nl, Dl, Bl, ql, Ul, Hl, zl);
  Ba.__defaultExtensionClasses = i({}, jl);
  var Vl = function() {
    n.SDK_DIST_CHANNEL = "npm";
    var e2 = ka[Ma] = new Ba();
    return function() {
      function e3() {
        e3.done || (e3.done = true, Aa = false, Lr(ka, function(e4) {
          e4._dom_loaded();
        }));
      }
      null != Ee && Ee.addEventListener ? "complete" === Ee.readyState ? e3() : qr(Ee, "DOMContentLoaded", e3, { capture: false }) : be && Tr.error("Browser doesn't support `document.addEventListener` so PostHog couldn't be initialized");
    }(), e2;
  }();

  // node_modules/posthog-js/dist/posthog-recorder.js
  !function() {
    "use strict";
    function t2(t3, e3, r3, i3, n3, s3, a3) {
      try {
        var o3 = t3[s3](a3), u3 = o3.value;
      } catch (t4) {
        return void r3(t4);
      }
      o3.done ? e3(u3) : Promise.resolve(u3).then(i3, n3);
    }
    function e2(e3) {
      return function() {
        var r3 = this, i3 = arguments;
        return new Promise(function(n3, s3) {
          var a3 = e3.apply(r3, i3);
          function o3(e4) {
            t2(a3, n3, s3, o3, u3, "next", e4);
          }
          function u3(e4) {
            t2(a3, n3, s3, o3, u3, "throw", e4);
          }
          o3(void 0);
        });
      };
    }
    function r2() {
      return r2 = Object.assign ? Object.assign.bind() : function(t3) {
        for (var e3 = 1; arguments.length > e3; e3++) {
          var r3 = arguments[e3];
          for (var i3 in r3) ({}).hasOwnProperty.call(r3, i3) && (t3[i3] = r3[i3]);
        }
        return t3;
      }, r2.apply(null, arguments);
    }
    var i2, n2 = ["type"], s2 = Object.defineProperty, a2 = (t3, e3, r3) => ((t4, e4, r4) => e4 in t4 ? s2(t4, e4, { enumerable: true, configurable: true, writable: true, value: r4 }) : t4[e4] = r4)(t3, "symbol" != typeof e3 ? e3 + "" : e3, r3), o2 = ((t3) => (t3[t3.DomContentLoaded = 0] = "DomContentLoaded", t3[t3.Load = 1] = "Load", t3[t3.FullSnapshot = 2] = "FullSnapshot", t3[t3.IncrementalSnapshot = 3] = "IncrementalSnapshot", t3[t3.Meta = 4] = "Meta", t3[t3.Custom = 5] = "Custom", t3[t3.Plugin = 6] = "Plugin", t3))(o2 || {}), u2 = ((t3) => (t3[t3.Mutation = 0] = "Mutation", t3[t3.MouseMove = 1] = "MouseMove", t3[t3.MouseInteraction = 2] = "MouseInteraction", t3[t3.Scroll = 3] = "Scroll", t3[t3.ViewportResize = 4] = "ViewportResize", t3[t3.Input = 5] = "Input", t3[t3.TouchMove = 6] = "TouchMove", t3[t3.MediaInteraction = 7] = "MediaInteraction", t3[t3.StyleSheetRule = 8] = "StyleSheetRule", t3[t3.CanvasMutation = 9] = "CanvasMutation", t3[t3.Font = 10] = "Font", t3[t3.Log = 11] = "Log", t3[t3.Drag = 12] = "Drag", t3[t3.StyleDeclaration = 13] = "StyleDeclaration", t3[t3.Selection = 14] = "Selection", t3[t3.AdoptedStyleSheet = 15] = "AdoptedStyleSheet", t3[t3.CustomElement = 16] = "CustomElement", t3))(u2 || {}), l2 = ((t3) => (t3[t3.MouseUp = 0] = "MouseUp", t3[t3.MouseDown = 1] = "MouseDown", t3[t3.Click = 2] = "Click", t3[t3.ContextMenu = 3] = "ContextMenu", t3[t3.DblClick = 4] = "DblClick", t3[t3.Focus = 5] = "Focus", t3[t3.Blur = 6] = "Blur", t3[t3.TouchStart = 7] = "TouchStart", t3[t3.TouchMove_Departed = 8] = "TouchMove_Departed", t3[t3.TouchEnd = 9] = "TouchEnd", t3[t3.TouchCancel = 10] = "TouchCancel", t3))(l2 || {}), h2 = ((t3) => (t3[t3.Mouse = 0] = "Mouse", t3[t3.Pen = 1] = "Pen", t3[t3.Touch = 2] = "Touch", t3))(h2 || {}), d2 = ((t3) => (t3[t3["2D"] = 0] = "2D", t3[t3.WebGL = 1] = "WebGL", t3[t3.WebGL2 = 2] = "WebGL2", t3))(d2 || {}), c2 = ((t3) => (t3[t3.Play = 0] = "Play", t3[t3.Pause = 1] = "Pause", t3[t3.Seeked = 2] = "Seeked", t3[t3.VolumeChange = 3] = "VolumeChange", t3[t3.RateChange = 4] = "RateChange", t3))(c2 || {}), v2 = ((t3) => (t3[t3.Document = 0] = "Document", t3[t3.DocumentType = 1] = "DocumentType", t3[t3.Element = 2] = "Element", t3[t3.Text = 3] = "Text", t3[t3.CDATA = 4] = "CDATA", t3[t3.Comment = 5] = "Comment", t3))(v2 || {}), f2 = { Node: ["childNodes", "parentNode", "parentElement", "textContent"], ShadowRoot: ["host", "styleSheets"], Element: ["shadowRoot"], MutationObserver: [] }, p2 = { Node: ["contains", "getRootNode"], ShadowRoot: ["getSelection"], Element: ["querySelector", "querySelectorAll"], MutationObserver: ["constructor"] }, m2 = {};
    function g2(t3) {
      if (m2[t3]) return m2[t3];
      var e3 = function(t4) {
        var e4, r4, i4 = null == (r4 = null == (e4 = null == globalThis ? void 0 : globalThis.Zone) ? void 0 : e4.__symbol__) ? void 0 : r4.call(e4, t4);
        return i4 && globalThis[i4] ? globalThis[i4] : void 0;
      }(t3) || globalThis[t3], r3 = e3.prototype, i3 = t3 in f2 ? f2[t3] : void 0, n3 = Boolean(i3 && i3.every((t4) => {
        var e4, i4;
        return Boolean(null == (i4 = null == (e4 = Object.getOwnPropertyDescriptor(r3, t4)) ? void 0 : e4.get) ? void 0 : i4.toString().includes("[native code]"));
      })), s3 = t3 in p2 ? p2[t3] : void 0, a3 = Boolean(s3 && s3.every((t4) => {
        var e4;
        return "function" == typeof r3[t4] && (null == (e4 = r3[t4]) ? void 0 : e4.toString().includes("[native code]"));
      }));
      if (n3 && a3) return m2[t3] = e3.prototype, e3.prototype;
      var o3 = document.createElement("iframe");
      o3.style.display = "none";
      var u3, l3 = false;
      try {
        document.body.appendChild(o3);
        var h3 = o3.contentWindow;
        if (!h3) return e3.prototype;
        var d3 = h3[t3].prototype;
        return d3 ? ((u3 = navigator.userAgent).includes("Safari") && !u3.includes("Chrome") && (o3.classList.add("rr-block", "ph-no-capture"), o3.setAttribute("__rrwebUntaintedPrototype", t3), l3 = true), m2[t3] = d3) : r3;
      } catch (t4) {
        return r3;
      } finally {
        !l3 && o3.parentNode && document.body.removeChild(o3);
      }
    }
    var y2 = {};
    function w2(t3, e3, r3) {
      var i3, n3 = t3 + "." + String(r3);
      if (y2[n3]) return y2[n3].call(e3);
      var s3 = g2(t3), a3 = null == (i3 = Object.getOwnPropertyDescriptor(s3, r3)) ? void 0 : i3.get;
      return a3 ? (y2[n3] = a3, a3.call(e3)) : e3[r3];
    }
    var b2 = {};
    function k2(t3, e3, r3) {
      var i3 = t3 + "." + String(r3);
      if (b2[i3]) return b2[i3].bind(e3);
      var n3 = g2(t3)[r3];
      return "function" != typeof n3 ? e3[r3] : (b2[i3] = n3, n3.bind(e3));
    }
    function _2() {
      return g2("MutationObserver").constructor;
    }
    function S2(t3, e3, r3) {
      try {
        if (!(e3 in t3)) return () => {
        };
        var i3 = t3[e3], n3 = { next: i3 }, s3 = r3(function() {
          for (var t4 = arguments.length, e4 = new Array(t4), r4 = 0; t4 > r4; r4++) e4[r4] = arguments[r4];
          return n3.next.apply(this, e4);
        });
        return "function" == typeof s3 && (s3.prototype = s3.prototype || {}, Object.defineProperties(s3, { __rrweb_original__: { enumerable: false, value: i3 }, __rrweb_layer__: { enumerable: false, value: n3 } })), t3[e3] = s3, () => {
          if (t3[e3] !== s3) for (var r4 = t3[e3]; "function" == typeof r4 && r4.__rrweb_layer__; ) {
            var i4 = r4.__rrweb_layer__;
            if (i4.next === s3) return void (i4.next = n3.next);
            r4 = i4.next;
          }
          else t3[e3] = n3.next;
        };
      } catch (t4) {
        return () => {
        };
      }
    }
    var I2 = { childNodes: (t3) => w2("Node", t3, "childNodes"), parentNode: (t3) => w2("Node", t3, "parentNode"), parentElement: (t3) => w2("Node", t3, "parentElement"), textContent: (t3) => w2("Node", t3, "textContent"), contains: (t3, e3) => k2("Node", t3, "contains")(e3), getRootNode: (t3) => k2("Node", t3, "getRootNode")(), host: (t3) => t3 && "host" in t3 ? w2("ShadowRoot", t3, "host") : null, styleSheets: (t3) => t3.styleSheets, shadowRoot: (t3) => t3 && "shadowRoot" in t3 ? w2("Element", t3, "shadowRoot") : null, querySelector: (t3, e3) => k2("Element", t3, "querySelector")(e3), querySelectorAll: (t3, e3) => k2("Element", t3, "querySelectorAll")(e3), mutationObserver: _2, patch: S2 };
    function M2(t3) {
      return t3.nodeType === t3.ELEMENT_NODE;
    }
    function C2(t3) {
      var e3 = t3 && "host" in t3 && "mode" in t3 && I2.host(t3) || null;
      return Boolean(e3 && "shadowRoot" in e3 && I2.shadowRoot(e3) === t3);
    }
    function x2(t3) {
      return "[object ShadowRoot]" === {}.toString.call(t3);
    }
    function R2(t3) {
      try {
        var e3 = t3.rules || t3.cssRules;
        if (!e3) return null;
        var r3 = t3.href;
        return !r3 && t3.ownerNode && (r3 = t3.ownerNode.baseURI), (i3 = Array.from(e3, (t4) => T2(t4, r3)).join("")).includes(" background-clip: text;") && !i3.includes(" -webkit-background-clip: text;") && (i3 = i3.replace(/\sbackground-clip:\s*text;/g, " -webkit-background-clip: text; background-clip: text;")), i3;
      } catch (t4) {
        return null;
      }
      var i3;
    }
    function T2(t3, e3) {
      var r3;
      if (function(t4) {
        return "styleSheet" in t4;
      }(t3)) {
        var i3;
        try {
          i3 = R2(t3.styleSheet) || function(t4) {
            var e4 = t4.cssText;
            if (3 > e4.split('"').length) return e4;
            var r4 = ["@import", "url(" + JSON.stringify(t4.href) + ")"];
            return "" === t4.layerName ? r4.push("layer") : t4.layerName && r4.push("layer(" + t4.layerName + ")"), t4.supportsText && r4.push("supports(" + t4.supportsText + ")"), t4.media.length && r4.push(t4.media.mediaText), r4.join(" ") + ";";
          }(t3);
        } catch (e4) {
          i3 = t3.cssText;
        }
        try {
          if (i3 && (null == (r3 = t3.styleSheet) ? void 0 : r3.href)) return B2(i3, t3.styleSheet.href);
        } catch (t4) {
        }
        return i3;
      }
      var n3 = t3.cssText;
      return function(t4) {
        return "selectorText" in t4;
      }(t3) && t3.selectorText.includes(":") && (n3 = n3.replace(/(\[(?:[\w-]+)[^\\])(:(?:[\w-]+)\])/gm, "$1\\$2")), e3 ? B2(n3, e3) : n3;
    }
    class O2 {
      constructor() {
        a2(this, "idNodeMap", /* @__PURE__ */ new Map()), a2(this, "nodeMetaMap", /* @__PURE__ */ new WeakMap());
      }
      getId(t3) {
        var e3;
        if (!t3) return -1;
        var r3 = null == (e3 = this.getMeta(t3)) ? void 0 : e3.id;
        return null != r3 ? r3 : -1;
      }
      getNode(t3) {
        return this.idNodeMap.get(t3) || null;
      }
      getIds() {
        return Array.from(this.idNodeMap.keys());
      }
      getMeta(t3) {
        return this.nodeMetaMap.get(t3) || null;
      }
      removeNodeFromMap(t3) {
        var e3 = this.getId(t3);
        if (this.idNodeMap.delete(e3), t3.childNodes && t3.childNodes.forEach((t4) => this.removeNodeFromMap(t4)), M2(t3)) {
          var r3 = I2.shadowRoot(t3);
          r3 && this.removeNodeFromMap(r3), "IFRAME" === t3.nodeName && t3.contentDocument && this.removeNodeFromMap(t3.contentDocument);
        }
      }
      has(t3) {
        return this.idNodeMap.has(t3);
      }
      hasNode(t3) {
        return this.nodeMetaMap.has(t3);
      }
      add(t3, e3) {
        this.idNodeMap.set(e3.id, t3), this.nodeMetaMap.set(t3, e3);
      }
      replace(t3, e3) {
        var r3 = this.getNode(t3);
        if (r3) {
          var i3 = this.nodeMetaMap.get(r3);
          i3 && this.nodeMetaMap.set(e3, i3);
        }
        this.idNodeMap.set(t3, e3);
      }
      reset() {
        this.idNodeMap = /* @__PURE__ */ new Map(), this.nodeMetaMap = /* @__PURE__ */ new WeakMap();
      }
    }
    function A2(t3) {
      var e3 = t3.element, r3 = t3.maskInputOptions, i3 = t3.tagName, n3 = t3.type, s3 = t3.maskInputFn, a3 = t3.value || "", o3 = n3 && E2(n3);
      return (r3[i3.toLowerCase()] || o3 && r3[o3]) && (a3 = s3 ? s3(a3, e3) : "*".repeat(a3.length)), a3;
    }
    function E2(t3) {
      return t3.toLowerCase();
    }
    var N2 = "__rrweb_original__";
    function L2(t3) {
      try {
        var e3 = t3.type;
        return t3.hasAttribute("data-rr-is-password") ? "password" : e3 ? E2(e3) : null;
      } catch (t4) {
        return null;
      }
    }
    var F2 = /url\((?:(')([^']*)'|(")(.*?)"|([^)]*))\)/gm, D2 = /^(?:[a-z+]+:)?\/\//i, P2 = /^www\..*/i, W2 = /^(data:)([^,]*),(.*)/i;
    function B2(t3, e3) {
      return (t3 || "").replace(F2, (t4, r3, i3, n3, s3, a3) => {
        var o3, u3 = i3 || s3 || a3, l3 = r3 || n3 || "";
        if (!u3) return t4;
        if (D2.test(u3) || P2.test(u3)) return "url(" + l3 + u3 + l3 + ")";
        if (W2.test(u3)) return "url(" + l3 + u3 + l3 + ")";
        if ("/" === u3[0]) return "url(" + l3 + (((o3 = e3).indexOf("//") > -1 ? o3.split("/").slice(0, 3).join("/") : o3.split("/")[0]).split("?")[0] + u3) + l3 + ")";
        var h3 = e3.split("/"), d3 = u3.split("/");
        for (var c3 of (h3.pop(), d3)) "." !== c3 && (".." === c3 ? h3.pop() : h3.push(c3));
        return "url(" + l3 + h3.join("/") + l3 + ")";
      });
    }
    var U2, z2, j2 = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxkZWZzPgogICAgPHBhdHRlcm4gaWQ9InN0cmlwZXMiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+CiAgICAgIDxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iYmxhY2siLz4KICAgICAgPHBhdGggZD0iTTggMEgxNkwwIDE2VjhMOCAwWiIgZmlsbD0iIzJEMkQyRCIvPgogICAgICA8cGF0aCBkPSJNMTYgOFYxNkg4TDE2IDhaIiBmaWxsPSIjMkQyRDJEIi8+CiAgICA8L3BhdHRlcm4+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjc3RyaXBlcykiLz4KPC9zdmc+Cg==", q2 = 4096, H2 = 1, G2 = new RegExp("[^a-z0-9-_:]"), V2 = -2;
    function Z2() {
      return H2++;
    }
    var J2 = /^[^ \t\n\r\u000c]+/, Q2 = /^[, \t\n\r\u000c]+/, X2 = /* @__PURE__ */ new WeakMap();
    function K2(t3, e3) {
      return e3 && "" !== e3.trim() ? Y2(t3, e3) : e3;
    }
    function Y2(t3, e3) {
      var r3 = X2.get(t3);
      if (r3 || (r3 = t3.createElement("a"), X2.set(t3, r3)), e3) {
        if (e3.startsWith("blob:") || e3.startsWith("data:")) return e3;
      } else e3 = "";
      return r3.setAttribute("href", e3), r3.href;
    }
    function tt2(t3, e3) {
      return (null == e3 ? void 0 : e3.maxBase64ImageLength) ? function(t4, e4) {
        return e4 && t4.length > e4 ? j2 : t4;
      }(t3, e3.maxBase64ImageLength) : t3;
    }
    function et2(t3, e3, r3, i3, n3, s3) {
      var a3;
      if (!i3) return i3;
      if ("src" === r3 || "href" === r3 && ("use" !== e3 || "#" !== i3[0])) {
        if ("link" === e3 && n3) {
          var o3 = null == (a3 = n3.sheet) ? void 0 : a3.href;
          if (o3) return o3;
        }
        var u3 = K2(t3, i3);
        if (u3.startsWith("data:")) {
          if ("img" === e3 && n3) {
            var l3 = u3;
            return ((null == s3 ? void 0 : s3.type) || void 0 !== (null == s3 ? void 0 : s3.quality)) && (l3 = function(t4, e4, r4, i4) {
              if (!t4.complete || 0 === t4.naturalWidth) return e4;
              if (t4.naturalWidth > q2 || t4.naturalHeight > q2) return e4;
              try {
                var n4 = document.createElement("canvas");
                n4.width = t4.naturalWidth, n4.height = t4.naturalHeight;
                var s4 = n4.getContext("2d");
                return s4 ? (s4.drawImage(t4, 0, 0), n4.toDataURL(r4 || "image/webp", null != i4 ? i4 : 0.4)) : e4;
              } catch (t5) {
                return e4;
              }
            }(n3, u3, s3.type, s3.quality)), tt2(l3, s3);
          }
          if ("image" === e3) return tt2(u3, s3);
        }
        return u3;
      }
      if ("xlink:href" === r3 && "#" !== i3[0]) {
        var h3 = K2(t3, i3);
        return "image" === e3 && h3.startsWith("data:") ? tt2(h3, s3) : h3;
      }
      return "background" !== r3 || "table" !== e3 && "td" !== e3 && "th" !== e3 ? "srcset" === r3 ? function(t4, e4) {
        if ("" === e4.trim()) return e4;
        var r4 = 0;
        function i4(t5) {
          var i5, n5 = t5.exec(e4.substring(r4));
          return n5 ? (r4 += (i5 = n5[0]).length, i5) : "";
        }
        for (var n4 = []; i4(Q2), e4.length > r4; ) {
          var s4 = i4(J2);
          if ("," === s4.slice(-1)) s4 = K2(t4, s4.substring(0, s4.length - 1)), n4.push(s4);
          else {
            var a4 = "";
            s4 = K2(t4, s4);
            for (var o4 = false; ; ) {
              var u4 = e4.charAt(r4);
              if ("" === u4) {
                n4.push((s4 + a4).trim());
                break;
              }
              if (o4) ")" === u4 && (o4 = false);
              else {
                if ("," === u4) {
                  r4 += 1, n4.push((s4 + a4).trim());
                  break;
                }
                "(" === u4 && (o4 = true);
              }
              a4 += u4, r4 += 1;
            }
          }
        }
        return n4.join(", ");
      }(t3, i3) : "style" === r3 ? B2(i3, Y2(t3)) : "object" === e3 && "data" === r3 ? K2(t3, i3) : i3 : K2(t3, i3);
    }
    function rt2(t3, e3, r3) {
      return ("video" === t3 || "audio" === t3) && "autoplay" === e3;
    }
    function it2(t3, e3, r3) {
      if (!t3) return false;
      if (t3.nodeType !== t3.ELEMENT_NODE) return !!r3 && it2(I2.parentNode(t3), e3, r3);
      for (var i3 = t3.classList.length; i3--; ) if (e3.test(t3.classList[i3])) return true;
      return !!r3 && it2(I2.parentNode(t3), e3, r3);
    }
    function nt2(t3, e3, r3, i3) {
      var n3;
      if (M2(t3)) {
        if (!I2.childNodes(n3 = t3).length) return false;
      } else {
        if (null === I2.parentElement(t3)) return false;
        n3 = I2.parentElement(t3);
      }
      try {
        if ("string" == typeof e3) {
          if (i3) {
            if (n3.closest("." + e3)) return true;
          } else if (n3.classList.contains(e3)) return true;
        } else if (it2(n3, e3, i3)) return true;
        if (r3) {
          if (i3) {
            if (n3.closest(r3)) return true;
          } else if (n3.matches(r3)) return true;
        }
      } catch (t4) {
      }
      return false;
    }
    function st2(t3, e3, r3) {
      var i3 = t3.removeEventListener;
      "function" == typeof i3 && i3.call(t3, e3, r3);
    }
    var at2 = /* @__PURE__ */ new Map();
    function ot2(t3, e3) {
      return Array.from(t3.styleSheets).find((t4) => t4.href === e3);
    }
    function ut2(t3) {
      return null == t3 ? "" : t3.toLowerCase();
    }
    var lt2 = 50, ht2 = false, dt2 = false;
    function ct2(t3, e3) {
      var r3 = e3.doc, i3 = e3.mirror, n3 = e3.blockClass, s3 = e3.blockSelector, a3 = e3.maskTextClass, o3 = e3.maskTextSelector, u3 = e3.skipChild, l3 = void 0 !== u3 && u3, h3 = e3.inlineStylesheet, d3 = void 0 === h3 || h3, c3 = e3.maskInputOptions, f3 = void 0 === c3 ? {} : c3, p3 = e3.maskTextFn, m3 = e3.maskInputFn, g3 = e3.slimDOMOptions, y3 = e3.dataURLOptions, w3 = void 0 === y3 ? {} : y3, b3 = e3.inlineImages, k3 = void 0 !== b3 && b3, _3 = e3.recordCanvas, S3 = void 0 !== _3 && _3, T3 = e3.onSerialize, O3 = e3.onIframeLoad, F3 = e3.iframeLoadTimeout, D3 = void 0 === F3 ? 5e3 : F3, P3 = e3.onIframeListenerRegistered, W3 = e3.onStylesheetLoad, j3 = e3.stylesheetLoadTimeout, q3 = void 0 === j3 ? 5e3 : j3, H3 = e3.keepIframeSrcFn, J3 = void 0 === H3 ? () => false : H3, Q3 = e3.newlyAddedElement, X3 = void 0 !== Q3 && Q3, K3 = e3.depth, tt3 = void 0 === K3 ? 0 : K3, it3 = e3.maxDepth, vt3 = void 0 === it3 ? lt2 : it3, ft3 = e3.needsMask, pt3 = e3.preserveWhiteSpace, mt3 = void 0 === pt3 || pt3;
      if (tt3 >= vt3) return dt2 = true, ht2 || (ht2 = true, console.warn("[rrweb-snapshot] DOM tree depth exceeded max depth of " + vt3 + ". Children beyond this depth will not be recorded. This may indicate deeply nested DOM structures.")), null;
      ft3 || (ft3 = nt2(t3, a3, o3, void 0 === ft3));
      var gt3, yt3 = function(t4, e4) {
        var r4 = e4.doc, i4 = e4.blockClass, n4 = e4.blockSelector, s4 = e4.needsMask, a4 = e4.inlineStylesheet, o4 = e4.maskInputOptions, u4 = void 0 === o4 ? {} : o4, l4 = e4.maskTextFn, h4 = e4.maskInputFn, d4 = e4.dataURLOptions, c4 = void 0 === d4 ? {} : d4, f4 = e4.inlineImages, p4 = e4.recordCanvas, m4 = e4.keepIframeSrcFn, g4 = e4.newlyAddedElement, y4 = void 0 !== g4 && g4, w4 = function(t5, e5) {
          if (e5.hasNode(t5)) {
            var r5 = e5.getId(t5);
            return 1 === r5 ? void 0 : r5;
          }
        }(r4, e4.mirror);
        switch (t4.nodeType) {
          case t4.DOCUMENT_NODE:
            return "CSS1Compat" !== t4.compatMode ? { type: v2.Document, childNodes: [], compatMode: t4.compatMode } : { type: v2.Document, childNodes: [] };
          case t4.DOCUMENT_TYPE_NODE:
            return { type: v2.DocumentType, name: t4.name, publicId: t4.publicId, systemId: t4.systemId, rootId: w4 };
          case t4.ELEMENT_NODE:
            return function(t5, e5) {
              for (var r5, i5, n5, s5, a5 = e5.doc, o5 = e5.inlineStylesheet, u5 = e5.maskInputOptions, l5 = void 0 === u5 ? {} : u5, h5 = e5.maskInputFn, d5 = e5.dataURLOptions, c5 = void 0 === d5 ? {} : d5, f5 = e5.inlineImages, p5 = e5.recordCanvas, m5 = e5.keepIframeSrcFn, g5 = e5.newlyAddedElement, y5 = void 0 !== g5 && g5, w5 = e5.rootId, b4 = function(t6, e6, r6) {
                try {
                  if ("string" == typeof e6) {
                    if (t6.classList.contains(e6)) return true;
                  } else for (var i6 = t6.classList.length; i6--; ) if (e6.test(t6.classList[i6])) return true;
                  if (r6) return t6.matches(r6);
                } catch (t7) {
                }
                return false;
              }(t5, e5.blockClass, e5.blockSelector), k4 = function(t6) {
                if (t6 instanceof HTMLFormElement) return "form";
                var e6 = E2(t6.tagName);
                return G2.test(e6) ? "div" : e6;
              }(t5), _4 = {}, S4 = t5.attributes.length, M3 = 0; S4 > M3; M3++) {
                var C3 = t5.attributes[M3];
                rt2(k4, C3.name) || (_4[C3.name] = et2(a5, k4, E2(C3.name), C3.value, t5, c5));
              }
              if ("link" === k4 && o5) {
                var x3 = t5.sheet;
                if (!x3) {
                  var T4 = function(t6) {
                    return t6.href;
                  }(t5);
                  T4 && !(x3 = ot2(a5, T4)) && T4.includes(".css") && (x3 = ot2(a5, window.location.origin + "/" + T4.replace(window.location.href, "")));
                }
                var O4 = null;
                x3 && (O4 = R2(x3)), O4 && (delete _4.rel, delete _4.href, _4._cssText = O4);
              }
              if ("style" === k4 && t5.sheet && !(t5.innerText || I2.textContent(t5) || "").trim().length) {
                var F4 = R2(t5.sheet);
                F4 && (_4._cssText = F4);
              }
              if ("input" === k4 || "textarea" === k4 || "select" === k4) {
                var D4 = t5.value, P4 = t5.checked;
                "radio" !== _4.type && "checkbox" !== _4.type && "submit" !== _4.type && "button" !== _4.type && D4 ? _4.value = A2({ element: t5, type: L2(t5), tagName: k4, value: D4, maskInputOptions: l5, maskInputFn: h5 }) : P4 && (_4.checked = P4);
              }
              if ("option" === k4 && (t5.selected && !l5.select ? _4.selected = true : delete _4.selected), "dialog" === k4 && t5.open) try {
                _4.rr_open_mode = t5.matches("dialog:modal") ? "modal" : "non-modal";
              } catch (t6) {
                _4.rr_open_mode = "modal", _4.ph_rr_could_not_detect_modal = true;
              }
              if ("canvas" === k4 && p5) {
                if ("2d" === t5.__context) (function(t6) {
                  var e6 = t6.getContext("2d");
                  if (!e6) return true;
                  for (var r6 = 0; t6.width > r6; r6 += 50) for (var i6 = 0; t6.height > i6; i6 += 50) {
                    var n6 = e6.getImageData;
                    if (new Uint32Array((N2 in n6 ? n6[N2] : n6).call(e6, r6, i6, Math.min(50, t6.width - r6), Math.min(50, t6.height - i6)).data.buffer).some((t7) => 0 !== t7)) return false;
                  }
                  return true;
                })(t5) || (_4.rr_dataURL = t5.toDataURL(c5.type, c5.quality));
                else if (!("__context" in t5)) {
                  var W4 = t5.toDataURL(c5.type, c5.quality), B3 = a5.createElement("canvas");
                  B3.width = t5.width, B3.height = t5.height, W4 !== B3.toDataURL(c5.type, c5.quality) && (_4.rr_dataURL = W4);
                }
              }
              if ("img" === k4 && f5) {
                U2 || (U2 = a5.createElement("canvas"), z2 = U2.getContext("2d"));
                var j4 = t5, q4 = j4.currentSrc || j4.getAttribute("src") || "<unknown-src>", H4 = j4.crossOrigin, V3 = () => {
                  st2(j4, "load", V3);
                  try {
                    U2.width = j4.naturalWidth, U2.height = j4.naturalHeight, z2.drawImage(j4, 0, 0), _4.rr_dataURL = U2.toDataURL(c5.type, c5.quality);
                  } catch (t6) {
                    if ("anonymous" !== j4.crossOrigin) return j4.crossOrigin = "anonymous", void (j4.complete && 0 !== j4.naturalWidth ? V3() : j4.addEventListener("load", V3));
                    console.warn("Cannot inline img src=" + q4 + "! Error: " + t6);
                  }
                  "anonymous" === j4.crossOrigin && (H4 ? _4.crossOrigin = H4 : j4.removeAttribute("crossorigin"));
                };
                j4.complete && 0 !== j4.naturalWidth ? V3() : j4.addEventListener("load", V3);
              }
              if ("audio" === k4 || "video" === k4) {
                var Z3 = _4;
                Z3.rr_mediaState = t5.paused ? "paused" : "played", Z3.rr_mediaCurrentTime = t5.currentTime, Z3.rr_mediaPlaybackRate = t5.playbackRate, Z3.rr_mediaMuted = t5.muted, Z3.rr_mediaLoop = t5.loop, Z3.rr_mediaVolume = t5.volume;
              }
              if (y5 || (t5.scrollLeft && (_4.rr_scrollLeft = t5.scrollLeft), t5.scrollTop && (_4.rr_scrollTop = t5.scrollTop)), b4) {
                var J4 = t5.getBoundingClientRect(), Q4 = J4.width, X4 = J4.height, K4 = J4.left, Y3 = J4.top, tt4 = null == (r5 = a5.defaultView) ? void 0 : r5.getComputedStyle(t5);
                _4 = { class: _4.class, rr_width: Q4 + "px", rr_height: X4 + "px", rr_left: Math.floor(K4 + ((null == (i5 = a5.defaultView) ? void 0 : i5.scrollX) || 0)) + "px", rr_top: Math.floor(Y3 + ((null == (n5 = a5.defaultView) ? void 0 : n5.scrollY) || 0)) + "px" }, tt4 && (_4.rr_position = tt4.position || "static", tt4.transform && "none" !== tt4.transform && (_4.rr_transform = tt4.transform), tt4.display && tt4.display.startsWith("inline") && (_4.rr_display = tt4.display));
              }
              "iframe" !== k4 || m5(_4.src) || (t5.contentDocument || (_4.rr_src = _4.src), delete _4.src);
              try {
                customElements.get(k4) && (s5 = true);
              } catch (t6) {
              }
              return { type: v2.Element, tagName: k4, attributes: _4, childNodes: [], isSVG: (it4 = t5, Boolean("svg" === it4.tagName || it4.ownerSVGElement) || void 0), needBlock: b4, rootId: w5, isCustom: s5 };
              var it4;
            }(t4, { doc: r4, blockClass: i4, blockSelector: n4, inlineStylesheet: a4, maskInputOptions: u4, maskInputFn: h4, dataURLOptions: c4, inlineImages: f4, recordCanvas: p4, keepIframeSrcFn: m4, newlyAddedElement: y4, rootId: w4 });
          case t4.TEXT_NODE:
            return function(t5, e5) {
              var r5, i5 = e5.needsMask, n5 = e5.maskTextFn, s5 = e5.rootId, a5 = I2.parentNode(t5), o5 = a5 && a5.tagName, u5 = I2.textContent(t5), l5 = "STYLE" === o5 || void 0, h5 = "SCRIPT" === o5 || void 0;
              if (l5 && u5) {
                try {
                  if (t5.nextSibling || t5.previousSibling) ;
                  else if (null == (r5 = a5.sheet) ? void 0 : r5.cssRules) {
                    var d5 = R2(a5.sheet);
                    d5 && !/(?:^|[\s;{}])-?[a-zA-Z][\w-]*\s*:\s*;/.test(d5) && (u5 = d5);
                  }
                } catch (e6) {
                  console.warn("Cannot get CSS styles from text's parentNode. Error: " + e6, t5);
                }
                u5 = B2(u5, Y2(e5.doc));
              }
              return h5 && (u5 = "SCRIPT_PLACEHOLDER"), !l5 && !h5 && u5 && i5 && (u5 = n5 ? n5(u5, I2.parentElement(t5)) : u5.replace(/[\S]/g, "*")), { type: v2.Text, textContent: u5 || "", isStyle: l5, rootId: s5 };
            }(t4, { doc: r4, needsMask: s4, maskTextFn: l4, rootId: w4 });
          case t4.CDATA_SECTION_NODE:
            return { type: v2.CDATA, textContent: "", rootId: w4 };
          case t4.COMMENT_NODE:
            return { type: v2.Comment, textContent: I2.textContent(t4) || "", rootId: w4 };
          default:
            return false;
        }
      }(t3, { doc: r3, mirror: i3, blockClass: n3, blockSelector: s3, needsMask: ft3, inlineStylesheet: d3, maskInputOptions: f3, maskTextFn: p3, maskInputFn: m3, dataURLOptions: w3, inlineImages: k3, recordCanvas: S3, keepIframeSrcFn: J3, newlyAddedElement: X3 });
      if (!yt3) return console.warn(t3, "not serialized"), null;
      gt3 = i3.hasNode(t3) ? i3.getId(t3) : function(t4, e4) {
        if (e4.comment && t4.type === v2.Comment) return true;
        if (t4.type === v2.Element) {
          if (e4.script && ("script" === t4.tagName || "link" === t4.tagName && ("preload" === t4.attributes.rel && "script" === t4.attributes.as || "modulepreload" === t4.attributes.rel) || "link" === t4.tagName && "prefetch" === t4.attributes.rel && "string" == typeof t4.attributes.href && "js" === function(t5, e5) {
            var r4, i4;
            try {
              i4 = new URL(t5, window.location.href);
            } catch (t6) {
              return null;
            }
            var n4 = i4.pathname.match(/\.([0-9a-z]+)(?:$)/i);
            return null !== (r4 = null == n4 ? void 0 : n4[1]) && void 0 !== r4 ? r4 : null;
          }(t4.attributes.href))) return true;
          if (e4.headFavicon && ("link" === t4.tagName && "shortcut icon" === t4.attributes.rel || "meta" === t4.tagName && (ut2(t4.attributes.name).match(/^msapplication-tile(image|color)$/) || "application-name" === ut2(t4.attributes.name) || ["icon", "apple-touch-icon", "shortcut icon"].includes(ut2(t4.attributes.rel))))) return true;
          if ("meta" === t4.tagName) {
            if (e4.headMetaDescKeywords && ut2(t4.attributes.name).match(/^description|keywords$/)) return true;
            if (e4.headMetaSocial && (ut2(t4.attributes.property).match(/^(og|twitter|fb):/) || ut2(t4.attributes.name).match(/^(og|twitter):/) || "pinterest" === ut2(t4.attributes.name))) return true;
            if (e4.headMetaRobots && ["robots", "googlebot", "bingbot"].includes(ut2(t4.attributes.name))) return true;
            if (e4.headMetaHttpEquiv && void 0 !== t4.attributes["http-equiv"]) return true;
            if (e4.headMetaAuthorship && (["author", "generator", "framework", "publisher", "progid"].includes(ut2(t4.attributes.name)) || ut2(t4.attributes.property).match(/^article:/) || ut2(t4.attributes.property).match(/^product:/))) return true;
            if (e4.headMetaVerification && ["google-site-verification", "yandex-verification", "csrf-token", "p:domain_verify", "verify-v1", "verification", "shopify-checkout-api-token"].includes(ut2(t4.attributes.name))) return true;
          }
        }
        return false;
      }(yt3, g3) || !mt3 && yt3.type === v2.Text && !yt3.isStyle && !yt3.textContent.replace(/^\s+|\s+$/gm, "").length ? V2 : Z2();
      var wt3 = Object.assign(yt3, { id: gt3 });
      if (i3.add(t3, wt3), gt3 === V2) return null;
      T3 && T3(t3);
      var bt3 = !l3;
      if (wt3.type === v2.Element) {
        bt3 = bt3 && !wt3.needBlock, delete wt3.needBlock;
        var kt3 = I2.shadowRoot(t3);
        kt3 && x2(kt3) && (wt3.isShadowHost = true);
      }
      if ((wt3.type === v2.Document || wt3.type === v2.Element) && bt3) {
        g3.headWhitespace && wt3.type === v2.Element && "head" === wt3.tagName && (mt3 = false);
        var _t3 = { doc: r3, mirror: i3, blockClass: n3, blockSelector: s3, needsMask: ft3, maskTextClass: a3, maskTextSelector: o3, skipChild: l3, inlineStylesheet: d3, maskInputOptions: f3, maskTextFn: p3, maskInputFn: m3, slimDOMOptions: g3, dataURLOptions: w3, inlineImages: k3, recordCanvas: S3, preserveWhiteSpace: mt3, onSerialize: T3, onIframeLoad: O3, iframeLoadTimeout: D3, onIframeListenerRegistered: P3, onStylesheetLoad: W3, stylesheetLoadTimeout: q3, keepIframeSrcFn: J3, depth: tt3 + 1, maxDepth: vt3 };
        if (wt3.type === v2.Element && "textarea" === wt3.tagName && void 0 !== wt3.attributes.value) ;
        else for (var St3 of Array.from(I2.childNodes(t3))) {
          var It3 = ct2(St3, _t3);
          It3 && wt3.childNodes.push(It3);
        }
        var Mt3 = null;
        if (M2(t3) && (Mt3 = I2.shadowRoot(t3))) for (var Ct3 of Array.from(I2.childNodes(Mt3))) {
          var xt3 = ct2(Ct3, _t3);
          xt3 && (x2(Mt3) && (xt3.isShadow = true), wt3.childNodes.push(xt3));
        }
      }
      var Rt3 = I2.parentNode(t3);
      if (Rt3 && C2(Rt3) && x2(Rt3) && (wt3.isShadow = true), wt3.type === v2.Element && "iframe" === wt3.tagName) {
        var Tt3 = function(t4, e4, r4) {
          var i4, n4 = () => {
          }, s4 = t4.contentWindow;
          if (!s4) return n4;
          try {
            i4 = s4.document.readyState;
          } catch (t5) {
            return n4;
          }
          var a4 = () => e4();
          if ("complete" !== i4) {
            var o4 = false, u4 = null, l4 = () => {
              o4 || (o4 = true, null !== u4 && (clearTimeout(u4), u4 = null), st2(t4, "load", h4), t4.addEventListener("load", a4), e4());
            }, h4 = () => l4();
            return u4 = setTimeout(l4, r4), t4.addEventListener("load", h4), () => {
              null !== u4 && (clearTimeout(u4), u4 = null), o4 ? st2(t4, "load", a4) : (o4 = true, st2(t4, "load", h4));
            };
          }
          var d4, c4 = "about:blank";
          try {
            d4 = s4.location.href;
          } catch (t5) {
            return n4;
          }
          if (d4 !== c4 || t4.src === c4 || "" === t4.src) {
            var v3 = setTimeout(e4, 0);
            return t4.addEventListener("load", a4), () => {
              clearTimeout(v3), st2(t4, "load", a4);
            };
          }
          return t4.addEventListener("load", a4), () => {
            st2(t4, "load", a4);
          };
        }(t3, () => {
          var e4 = t3.contentDocument;
          if (e4 && O3) {
            var r4 = ct2(e4, { doc: e4, mirror: i3, blockClass: n3, blockSelector: s3, needsMask: ft3, maskTextClass: a3, maskTextSelector: o3, skipChild: false, inlineStylesheet: d3, maskInputOptions: f3, maskTextFn: p3, maskInputFn: m3, slimDOMOptions: g3, dataURLOptions: w3, inlineImages: k3, recordCanvas: S3, preserveWhiteSpace: mt3, onSerialize: T3, onIframeLoad: O3, iframeLoadTimeout: D3, onIframeListenerRegistered: P3, onStylesheetLoad: W3, stylesheetLoadTimeout: q3, keepIframeSrcFn: J3, depth: tt3 + 1, maxDepth: vt3 });
            r4 && O3(t3, r4);
          }
        }, D3);
        null == P3 || P3(t3, Tt3);
      }
      return wt3.type === v2.Element && "link" === wt3.tagName && "stylesheet" === wt3.attributes.rel && function(e4, u4, l4) {
        if (!at2.has(e4)) {
          var h4;
          try {
            h4 = e4.sheet;
          } catch (t4) {
            return;
          }
          if (!h4) {
            var c4 = new AbortController(), v3 = false, y4 = () => {
              if (!v3) {
                v3 = true;
                try {
                  (() => {
                    if (W3) {
                      var e5 = ct2(t3, { doc: r3, mirror: i3, blockClass: n3, blockSelector: s3, needsMask: ft3, maskTextClass: a3, maskTextSelector: o3, skipChild: false, inlineStylesheet: d3, maskInputOptions: f3, maskTextFn: p3, maskInputFn: m3, slimDOMOptions: g3, dataURLOptions: w3, inlineImages: k3, recordCanvas: S3, preserveWhiteSpace: mt3, onSerialize: T3, onIframeLoad: O3, iframeLoadTimeout: D3, onStylesheetLoad: W3, stylesheetLoadTimeout: q3, keepIframeSrcFn: J3, depth: tt3, maxDepth: vt3 });
                      e5 && W3(t3, e5);
                    }
                  })();
                } finally {
                  at2.delete(e4), c4.abort();
                }
              }
            }, b4 = setTimeout(y4, l4);
            c4.signal.addEventListener("abort", () => clearTimeout(b4), { once: true }), e4.addEventListener("load", y4, { signal: c4.signal, once: true }), at2.set(e4, c4);
          }
        }
      }(t3, 0, q3), wt3;
    }
    function vt2(t3) {
      return true === t3 || "all" === t3 ? { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaVerification: true, headMetaAuthorship: "all" === t3, headMetaDescKeywords: "all" === t3, headTitleMutations: "all" === t3 } : false === t3 ? {} : t3;
    }
    class ft2 {
      constructor() {
        a2(this, "parentElement", null), a2(this, "parentNode", null), a2(this, "ownerDocument"), a2(this, "firstChild", null), a2(this, "lastChild", null), a2(this, "previousSibling", null), a2(this, "nextSibling", null), a2(this, "ELEMENT_NODE", 1), a2(this, "TEXT_NODE", 3), a2(this, "nodeType"), a2(this, "nodeName"), a2(this, "RRNodeType");
      }
      get childNodes() {
        for (var t3 = [], e3 = this.firstChild; e3; ) t3.push(e3), e3 = e3.nextSibling;
        return t3;
      }
      contains(t3) {
        if (!(t3 instanceof ft2)) return false;
        if (t3.ownerDocument !== this.ownerDocument) return false;
        if (t3 === this) return true;
        for (; t3.parentNode; ) {
          if (t3.parentNode === this) return true;
          t3 = t3.parentNode;
        }
        return false;
      }
      appendChild(t3) {
        throw new Error("RRDomException: Failed to execute 'appendChild' on 'RRNode': This RRNode type does not support this method.");
      }
      insertBefore(t3, e3) {
        throw new Error("RRDomException: Failed to execute 'insertBefore' on 'RRNode': This RRNode type does not support this method.");
      }
      removeChild(t3) {
        throw new Error("RRDomException: Failed to execute 'removeChild' on 'RRNode': This RRNode type does not support this method.");
      }
      toString() {
        return "RRNode";
      }
    }
    function pt2(t3, e3, r3) {
      void 0 === r3 && (r3 = document);
      var i3 = { capture: true, passive: true };
      return r3.addEventListener(t3, e3, i3), () => mt2(r3, t3, e3, i3);
    }
    function mt2(t3, e3, r3, i3) {
      gt2(() => {
        var n3 = t3.removeEventListener;
        "function" == typeof n3 && (void 0 !== i3 ? n3.call(t3, e3, r3, i3) : n3.call(t3, e3, r3));
      });
    }
    function gt2(t3) {
      try {
        t3();
      } catch (t4) {
        if (!(t4 instanceof DOMException && "SecurityError" === t4.name)) throw t4;
      }
    }
    var yt2 = "Please stop import mirror directly. Instead of that,\r\nnow you can use replayer.getMirror() to access the mirror instance of a replayer,\r\nor you can use record.mirror to access the mirror instance during recording.", wt2 = { map: {}, getId() {
      return console.error(yt2), -1;
    }, getNode() {
      return console.error(yt2), null;
    }, removeNodeFromMap() {
      console.error(yt2);
    }, has() {
      return console.error(yt2), false;
    }, reset() {
      console.error(yt2);
    } };
    function bt2(t3, e3, r3) {
      void 0 === r3 && (r3 = {});
      var i3 = null, n3 = 0;
      return function() {
        for (var s3 = arguments.length, a3 = new Array(s3), o3 = 0; s3 > o3; o3++) a3[o3] = arguments[o3];
        var u3 = Date.now();
        n3 || false !== r3.leading || (n3 = u3);
        var l3 = e3 - (u3 - n3), h3 = this;
        0 >= l3 || l3 > e3 ? (i3 && (clearTimeout(i3), i3 = null), n3 = u3, t3.apply(h3, a3)) : i3 || false === r3.trailing || (i3 = setTimeout(() => {
          n3 = false === r3.leading ? 0 : Date.now(), i3 = null, t3.apply(h3, a3);
        }, l3));
      };
    }
    function kt2(t3, e3, r3, i3, n3) {
      void 0 === n3 && (n3 = window);
      var s3 = n3.Object.getOwnPropertyDescriptor(t3, e3);
      return n3.Object.defineProperty(t3, e3, i3 ? r3 : { set(t4) {
        if (setTimeout(() => {
          try {
            r3.set.call(this, t4);
          } catch (t5) {
          }
        }, 0), s3 && s3.set) {
          if (s3.get) try {
            s3.get.call(this);
          } catch (t5) {
            return;
          }
          s3.set.call(this, t4);
        }
      } }), () => kt2(t3, e3, s3 || {}, true);
    }
    "undefined" != typeof window && window.Proxy && window.Reflect && (wt2 = new Proxy(wt2, { get(t3, e3, r3) {
      return "map" === e3 && console.error(yt2), Reflect.get(t3, e3, r3);
    } }));
    var _t2 = Date.now;
    function St2(t3) {
      var e3, r3, i3, n3, s3 = t3.document;
      return { left: s3.scrollingElement ? s3.scrollingElement.scrollLeft : void 0 !== t3.pageXOffset ? t3.pageXOffset : s3.documentElement.scrollLeft || (null == s3 ? void 0 : s3.body) && (null == (e3 = I2.parentElement(s3.body)) ? void 0 : e3.scrollLeft) || (null == (r3 = null == s3 ? void 0 : s3.body) ? void 0 : r3.scrollLeft) || 0, top: s3.scrollingElement ? s3.scrollingElement.scrollTop : void 0 !== t3.pageYOffset ? t3.pageYOffset : (null == s3 ? void 0 : s3.documentElement.scrollTop) || (null == s3 ? void 0 : s3.body) && (null == (i3 = I2.parentElement(s3.body)) ? void 0 : i3.scrollTop) || (null == (n3 = null == s3 ? void 0 : s3.body) ? void 0 : n3.scrollTop) || 0 };
    }
    function It2() {
      return window.innerHeight || document.documentElement && document.documentElement.clientHeight || document.body && document.body.clientHeight;
    }
    function Mt2() {
      return window.innerWidth || document.documentElement && document.documentElement.clientWidth || document.body && document.body.clientWidth;
    }
    function Ct2(t3) {
      return t3 ? t3.nodeType === t3.ELEMENT_NODE ? t3 : I2.parentElement(t3) : null;
    }
    function xt2(t3, e3, r3, i3) {
      if (!t3) return false;
      var n3 = Ct2(t3);
      if (!n3) return false;
      try {
        if ("string" == typeof e3) {
          if (n3.classList.contains(e3)) return true;
          if (i3 && null !== n3.closest("." + e3)) return true;
        } else if (it2(n3, e3, i3)) return true;
      } catch (t4) {
      }
      if (r3) {
        if (n3.matches(r3)) return true;
        if (i3 && null !== n3.closest(r3)) return true;
      }
      return false;
    }
    function Rt2(t3, e3, r3) {
      return !("TITLE" !== t3.tagName || !r3.headTitleMutations) || e3.getId(t3) === V2;
    }
    function Tt2(t3, e3) {
      if (C2(t3)) return false;
      var r3 = e3.getId(t3);
      if (!e3.has(r3)) return true;
      var i3 = I2.parentNode(t3);
      return (!i3 || i3.nodeType !== t3.DOCUMENT_NODE) && (!i3 || Tt2(i3, e3));
    }
    function Ot2(t3) {
      return Boolean(t3.changedTouches);
    }
    function At2(t3, e3) {
      return Boolean("IFRAME" === t3.nodeName && e3.getMeta(t3));
    }
    function Et2(t3, e3) {
      return Boolean("LINK" === t3.nodeName && t3.nodeType === t3.ELEMENT_NODE && t3.getAttribute && "stylesheet" === t3.getAttribute("rel") && e3.getMeta(t3));
    }
    function Nt2(t3) {
      return !!t3 && (t3 instanceof ft2 && "shadowRoot" in t3 ? Boolean(t3.shadowRoot) : Boolean(I2.shadowRoot(t3)));
    }
    /[1-9][0-9]{12}/.test(Date.now().toString()) || (_t2 = () => (/* @__PURE__ */ new Date()).getTime());
    class Lt2 {
      constructor() {
        a2(this, "id", 1), a2(this, "styleIDMap", /* @__PURE__ */ new WeakMap()), a2(this, "idStyleMap", /* @__PURE__ */ new Map());
      }
      getId(t3) {
        var e3;
        return null !== (e3 = this.styleIDMap.get(t3)) && void 0 !== e3 ? e3 : -1;
      }
      has(t3) {
        return this.styleIDMap.has(t3);
      }
      add(t3, e3) {
        return this.has(t3) ? this.getId(t3) : (r3 = void 0 === e3 ? this.id++ : e3, this.styleIDMap.set(t3, r3), this.idStyleMap.set(r3, t3), r3);
        var r3;
      }
      getStyle(t3) {
        return this.idStyleMap.get(t3) || null;
      }
      reset() {
        this.styleIDMap = /* @__PURE__ */ new WeakMap(), this.idStyleMap = /* @__PURE__ */ new Map(), this.id = 1;
      }
      generateId() {
        return this.id++;
      }
    }
    function Ft2(t3) {
      var e3, r3 = null;
      return "getRootNode" in t3 && (null == (e3 = I2.getRootNode(t3)) ? void 0 : e3.nodeType) === Node.DOCUMENT_FRAGMENT_NODE && I2.host(I2.getRootNode(t3)) && (r3 = I2.host(I2.getRootNode(t3))), r3;
    }
    function Dt2(t3) {
      var e3 = t3.ownerDocument;
      return !!e3 && (I2.contains(e3, t3) || function(t4) {
        var e4 = t4.ownerDocument;
        if (!e4) return false;
        var r3 = function(t5) {
          for (var e5, r4 = t5; e5 = Ft2(r4); ) r4 = e5;
          return r4;
        }(t4);
        return I2.contains(e4, r3);
      }(t3));
    }
    function Pt2(t3) {
      return "__ln" in t3;
    }
    class Wt2 {
      constructor() {
        a2(this, "length", 0), a2(this, "head", null), a2(this, "tail", null);
      }
      get(t3) {
        if (t3 >= this.length) throw new Error("Position outside of list range");
        for (var e3 = this.head, r3 = 0; t3 > r3; r3++) e3 = (null == e3 ? void 0 : e3.next) || null;
        return e3;
      }
      addNode(t3) {
        var e3 = { value: t3, previous: null, next: null };
        if (t3.__ln = e3, t3.previousSibling && Pt2(t3.previousSibling)) {
          var r3 = t3.previousSibling.__ln.next;
          e3.next = r3, e3.previous = t3.previousSibling.__ln, t3.previousSibling.__ln.next = e3, r3 && (r3.previous = e3);
        } else if (t3.nextSibling && Pt2(t3.nextSibling) && t3.nextSibling.__ln.previous) {
          var i3 = t3.nextSibling.__ln.previous;
          e3.previous = i3, e3.next = t3.nextSibling.__ln, t3.nextSibling.__ln.previous = e3, i3 && (i3.next = e3);
        } else this.head && (this.head.previous = e3), e3.next = this.head, this.head = e3;
        null === e3.next && (this.tail = e3), this.length++;
      }
      removeNode(t3) {
        var e3 = t3.__ln;
        this.head && (e3.previous ? (e3.previous.next = e3.next, e3.next ? e3.next.previous = e3.previous : this.tail = e3.previous) : (this.head = e3.next, this.head ? this.head.previous = null : this.tail = null), t3.__ln && delete t3.__ln, this.length--);
      }
    }
    var Bt2, $t2 = (t3, e3) => t3 + "@" + e3;
    class Ut2 {
      constructor() {
        a2(this, "frozen", false), a2(this, "locked", false), a2(this, "texts", []), a2(this, "attributes", []), a2(this, "attributeMap", /* @__PURE__ */ new WeakMap()), a2(this, "removes", []), a2(this, "mapRemoves", []), a2(this, "movedMap", {}), a2(this, "addedSet", /* @__PURE__ */ new Set()), a2(this, "movedSet", /* @__PURE__ */ new Set()), a2(this, "droppedSet", /* @__PURE__ */ new Set()), a2(this, "removesSubTreeCache", /* @__PURE__ */ new Set()), a2(this, "mutationCb"), a2(this, "blockClass"), a2(this, "blockSelector"), a2(this, "maskTextClass"), a2(this, "maskTextSelector"), a2(this, "inlineStylesheet"), a2(this, "maskInputOptions"), a2(this, "maskTextFn"), a2(this, "maskInputFn"), a2(this, "keepIframeSrcFn"), a2(this, "recordCanvas"), a2(this, "inlineImages"), a2(this, "slimDOMOptions"), a2(this, "dataURLOptions"), a2(this, "doc"), a2(this, "mirror"), a2(this, "iframeManager"), a2(this, "stylesheetManager"), a2(this, "shadowDomManager"), a2(this, "canvasManager"), a2(this, "processedNodeManager"), a2(this, "unattachedDoc"), a2(this, "canvasManagerReleased", false), a2(this, "processMutations", (t3) => {
          t3.forEach(this.processMutation), this.emit();
        }), a2(this, "emit", () => {
          if (!this.frozen && !this.locked) {
            for (var t3 = [], e3 = /* @__PURE__ */ new Set(), r3 = new Wt2(), i3 = (t4) => {
              for (var e4 = t4, r4 = V2; r4 === V2; ) r4 = (e4 = e4 && e4.nextSibling) && this.mirror.getId(e4);
              return r4;
            }, n3 = (n4) => {
              var s4 = I2.parentNode(n4);
              if (s4 && Dt2(n4) && "TEXTAREA" !== s4.tagName) {
                var a4 = C2(s4) ? this.mirror.getId(Ft2(n4)) : this.mirror.getId(s4), o4 = i3(n4);
                if (-1 === a4 || -1 === o4) return r3.addNode(n4);
                var u4 = ct2(n4, { doc: this.doc, mirror: this.mirror, blockClass: this.blockClass, blockSelector: this.blockSelector, maskTextClass: this.maskTextClass, maskTextSelector: this.maskTextSelector, skipChild: true, newlyAddedElement: true, inlineStylesheet: this.inlineStylesheet, maskInputOptions: this.maskInputOptions, maskTextFn: this.maskTextFn, maskInputFn: this.maskInputFn, slimDOMOptions: this.slimDOMOptions, dataURLOptions: this.dataURLOptions, recordCanvas: this.recordCanvas, inlineImages: this.inlineImages, onSerialize: (t4) => {
                  At2(t4, this.mirror) && this.iframeManager.addIframe(t4), Et2(t4, this.mirror) && this.stylesheetManager.trackLinkElement(t4), Nt2(n4) && this.shadowDomManager.addShadowRoot(I2.shadowRoot(n4), this.doc);
                }, onIframeLoad: (t4, e4) => {
                  this.iframeManager.attachIframe(t4, e4), this.shadowDomManager.observeAttachShadow(t4);
                }, onIframeListenerRegistered: (t4, e4) => {
                  this.iframeManager.registerLoadListenerDisposer(t4, e4);
                }, onStylesheetLoad: (t4, e4) => {
                  this.stylesheetManager.attachLinkElement(t4, e4);
                } });
                u4 && (t3.push({ parentId: a4, nextId: o4, node: u4 }), e3.add(u4.id));
              }
            }; this.mapRemoves.length; ) this.mirror.removeNodeFromMap(this.mapRemoves.shift());
            for (var s3 of this.movedSet) jt2(this.removesSubTreeCache, s3) && !this.movedSet.has(I2.parentNode(s3)) || n3(s3);
            for (var a3 of this.addedSet) qt2(this.droppedSet, a3) || jt2(this.removesSubTreeCache, a3) ? qt2(this.movedSet, a3) ? n3(a3) : this.droppedSet.add(a3) : n3(a3);
            for (var o3 = null; r3.length; ) {
              var u3 = null;
              if (o3) {
                var l3 = this.mirror.getId(I2.parentNode(o3.value)), h3 = i3(o3.value);
                -1 !== l3 && -1 !== h3 && (u3 = o3);
              }
              if (!u3) for (var d3 = r3.tail; d3; ) {
                var c3 = d3;
                if (d3 = d3.previous, c3) {
                  var v3 = this.mirror.getId(I2.parentNode(c3.value));
                  if (-1 === i3(c3.value)) continue;
                  if (-1 !== v3) {
                    u3 = c3;
                    break;
                  }
                  var f3 = I2.parentNode(c3.value);
                  if (f3 && f3.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                    var p3 = I2.host(f3);
                    if (-1 !== this.mirror.getId(p3)) {
                      u3 = c3;
                      break;
                    }
                  }
                }
              }
              if (!u3) {
                for (; r3.head; ) r3.removeNode(r3.head.value);
                break;
              }
              o3 = u3.previous, r3.removeNode(u3.value), n3(u3.value);
            }
            var m3 = { texts: this.texts.map((t4) => {
              var e4 = t4.node, r4 = I2.parentNode(e4);
              return r4 && "TEXTAREA" === r4.tagName && this.genTextAreaValueMutation(r4), { id: this.mirror.getId(e4), value: t4.value };
            }).filter((t4) => !e3.has(t4.id)).filter((t4) => this.mirror.has(t4.id)), attributes: this.attributes.map((t4) => {
              var e4 = t4.attributes;
              if ("string" == typeof e4.style) {
                var r4 = JSON.stringify(t4.styleDiff), i4 = JSON.stringify(t4._unchangedStyles);
                e4.style.length > r4.length && (r4 + i4).split("var(").length === e4.style.split("var(").length && (e4.style = t4.styleDiff);
              }
              return { id: this.mirror.getId(t4.node), attributes: e4 };
            }).filter((t4) => !e3.has(t4.id)).filter((t4) => this.mirror.has(t4.id)), removes: this.removes, adds: t3 };
            (m3.texts.length || m3.attributes.length || m3.removes.length || m3.adds.length) && (this.texts = [], this.attributes = [], this.attributeMap = /* @__PURE__ */ new WeakMap(), this.removes = [], this.addedSet = /* @__PURE__ */ new Set(), this.movedSet = /* @__PURE__ */ new Set(), this.droppedSet = /* @__PURE__ */ new Set(), this.removesSubTreeCache = /* @__PURE__ */ new Set(), this.movedMap = {}, this.mutationCb(m3));
          }
        }), a2(this, "bufferBelongsToIframe", (t3) => this.doc === t3.contentDocument), a2(this, "genTextAreaValueMutation", (t3) => {
          var e3 = this.attributeMap.get(t3);
          e3 || (this.attributes.push(e3 = { node: t3, attributes: {}, styleDiff: {}, _unchangedStyles: {} }), this.attributeMap.set(t3, e3));
          var r3 = Array.from(I2.childNodes(t3), (t4) => I2.textContent(t4) || "").join("");
          e3.attributes.value = A2({ element: t3, maskInputOptions: this.maskInputOptions, tagName: t3.tagName, type: L2(t3), value: r3, maskInputFn: this.maskInputFn });
        }), a2(this, "processMutation", (t3) => {
          if (!Rt2(t3.target, this.mirror, this.slimDOMOptions)) switch (t3.type) {
            case "characterData":
              var e3 = I2.textContent(t3.target);
              xt2(t3.target, this.blockClass, this.blockSelector, false) || e3 === t3.oldValue || this.texts.push({ value: nt2(t3.target, this.maskTextClass, this.maskTextSelector, true) && e3 ? this.maskTextFn ? this.maskTextFn(e3, Ct2(t3.target)) : e3.replace(/[\S]/g, "*") : e3, node: t3.target });
              break;
            case "attributes":
              var r3 = t3.target, i3 = t3.attributeName, n3 = t3.target.getAttribute(i3);
              if ("value" === i3) {
                var s3 = L2(r3);
                n3 = A2({ element: r3, maskInputOptions: this.maskInputOptions, tagName: r3.tagName, type: s3, value: n3, maskInputFn: this.maskInputFn });
              }
              if (xt2(t3.target, this.blockClass, this.blockSelector, false) || n3 === t3.oldValue) return;
              var a3 = this.attributeMap.get(t3.target);
              if ("IFRAME" === r3.tagName && "src" === i3 && !this.keepIframeSrcFn(n3)) {
                if (r3.contentDocument) return;
                i3 = "rr_src";
              }
              if (a3 || (this.attributes.push(a3 = { node: t3.target, attributes: {}, styleDiff: {}, _unchangedStyles: {} }), this.attributeMap.set(t3.target, a3)), "type" === i3 && "INPUT" === r3.tagName && "password" === (t3.oldValue || "").toLowerCase() && r3.setAttribute("data-rr-is-password", "true"), !rt2(r3.tagName, i3)) if (a3.attributes[i3] = et2(this.doc, E2(r3.tagName), E2(i3), n3, r3, this.dataURLOptions), "style" === i3) {
                if (!this.unattachedDoc) try {
                  this.unattachedDoc = document.implementation.createHTMLDocument();
                } catch (t4) {
                  this.unattachedDoc = this.doc;
                }
                var o3 = this.unattachedDoc.createElement("span");
                for (var u3 of (t3.oldValue && (o3.style.cssText = t3.oldValue), Array.from(r3.style))) {
                  var l3 = r3.style.getPropertyValue(u3), h3 = r3.style.getPropertyPriority(u3);
                  l3 !== o3.style.getPropertyValue(u3) || h3 !== o3.style.getPropertyPriority(u3) ? a3.styleDiff[u3] = "" === h3 ? l3 : [l3, h3] : a3._unchangedStyles[u3] = [l3, h3];
                }
                for (var d3 of Array.from(o3.style)) "" === r3.style.getPropertyValue(d3) && (a3.styleDiff[d3] = false);
              } else "open" === i3 && "DIALOG" === r3.tagName && (a3.attributes.rr_open_mode = r3.matches("dialog:modal") ? "modal" : "non-modal");
              break;
            case "childList":
              if (xt2(t3.target, this.blockClass, this.blockSelector, true)) return;
              if ("TEXTAREA" === t3.target.tagName) return void this.genTextAreaValueMutation(t3.target);
              t3.addedNodes.forEach((e4) => this.genAdds(e4, t3.target)), t3.removedNodes.forEach((e4) => {
                var r4 = this.mirror.getId(e4), i4 = C2(t3.target) ? this.mirror.getId(I2.host(t3.target)) : this.mirror.getId(t3.target);
                xt2(t3.target, this.blockClass, this.blockSelector, false) || Rt2(e4, this.mirror, this.slimDOMOptions) || !function(t4, e5) {
                  return -1 !== e5.getId(t4);
                }(e4, this.mirror) || (this.addedSet.has(e4) ? (zt2(this.addedSet, e4), this.droppedSet.add(e4)) : this.addedSet.has(t3.target) && -1 === r4 || Tt2(t3.target, this.mirror) || (this.movedSet.has(e4) && this.movedMap[$t2(r4, i4)] ? zt2(this.movedSet, e4) : (this.removes.push({ parentId: i4, id: r4, isShadow: !(!C2(t3.target) || !x2(t3.target)) || void 0 }), function(t4, e5) {
                  for (var r5 = [t4]; r5.length; ) {
                    var i5 = r5.pop();
                    e5.has(i5) || (e5.add(i5), I2.childNodes(i5).forEach((t5) => r5.push(t5)));
                  }
                }(e4, this.removesSubTreeCache))), this.mapRemoves.push(e4));
              });
          }
        }), a2(this, "genAdds", (t3, e3) => {
          if (!this.processedNodeManager.inOtherBuffer(t3, this)) {
            if (this.addedSet.has(t3)) return this.addedSet.delete(t3), void this.addedSet.add(t3);
            if (!this.movedSet.has(t3)) {
              if (this.mirror.hasNode(t3)) {
                if (Rt2(t3, this.mirror, this.slimDOMOptions)) return;
                this.movedSet.add(t3);
                var r3 = null;
                e3 && this.mirror.hasNode(e3) && (r3 = this.mirror.getId(e3)), r3 && -1 !== r3 && (this.movedMap[$t2(this.mirror.getId(t3), r3)] = true);
              } else this.addedSet.add(t3), this.droppedSet.delete(t3);
              xt2(t3, this.blockClass, this.blockSelector, false) || (I2.childNodes(t3).forEach((t4) => this.genAdds(t4)), Nt2(t3) && I2.childNodes(I2.shadowRoot(t3)).forEach((e4) => {
                this.processedNodeManager.add(e4, this), this.genAdds(e4, t3);
              }));
            }
          }
        });
      }
      init(t3) {
        ["mutationCb", "blockClass", "blockSelector", "maskTextClass", "maskTextSelector", "inlineStylesheet", "maskInputOptions", "maskTextFn", "maskInputFn", "keepIframeSrcFn", "recordCanvas", "inlineImages", "slimDOMOptions", "dataURLOptions", "doc", "mirror", "iframeManager", "stylesheetManager", "shadowDomManager", "canvasManager", "processedNodeManager"].forEach((e3) => {
          this[e3] = t3[e3];
        }), this.canvasManager.acquire();
      }
      freeze() {
        this.frozen = true, this.canvasManager.freeze();
      }
      unfreeze() {
        this.frozen = false, this.canvasManager.unfreeze(), this.emit();
      }
      isFrozen() {
        return this.frozen;
      }
      lock() {
        this.locked = true, this.canvasManager.lock();
      }
      unlock() {
        this.locked = false, this.canvasManager.unlock(), this.emit();
      }
      reset() {
        this.releaseCanvasManager();
      }
      releaseCanvasManager() {
        this.canvasManagerReleased || (this.canvasManagerReleased = true, this.canvasManager.reset());
      }
      bufferDoc() {
        return this.doc;
      }
      destroy() {
        for (; this.mapRemoves.length; ) this.mirror.removeNodeFromMap(this.mapRemoves.shift());
      }
    }
    function zt2(t3, e3) {
      t3.delete(e3), I2.childNodes(e3).forEach((e4) => zt2(t3, e4));
    }
    function jt2(t3, e3, r3) {
      return 0 !== t3.size && function(t4, e4, r4) {
        var i3 = I2.parentNode(e4);
        return !!i3 && t4.has(i3);
      }(t3, e3);
    }
    function qt2(t3, e3) {
      return 0 !== t3.size && Ht2(t3, e3);
    }
    function Ht2(t3, e3) {
      var r3 = I2.parentNode(e3);
      return !!r3 && (!!t3.has(r3) || Ht2(t3, r3));
    }
    var Gt2 = (t3) => Bt2 ? function() {
      try {
        return t3(...arguments);
      } catch (t4) {
        if (Bt2 && true === Bt2(t4)) return;
        throw t4;
      }
    } : t3, Vt2 = [];
    function Zt2(t3) {
      try {
        if ("composedPath" in t3) {
          var e3 = t3.composedPath();
          if (e3.length) return e3[0];
        } else if ("path" in t3 && t3.path.length) return t3.path[0];
      } catch (t4) {
      }
      return t3 && t3.target;
    }
    function Jt2(t3, e3) {
      var r3 = new Ut2();
      Vt2.push(r3), r3.init(t3);
      var i3 = new (_2())(Gt2(r3.processMutations.bind(r3))), n3 = { attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, childList: true, subtree: true };
      return t3.attributeFilter && t3.attributeFilter.length > 0 && (n3.attributeFilter = t3.attributeFilter), i3.observe(e3, n3), { observer: i3, buffer: r3 };
    }
    function Qt2(t3) {
      var e3 = t3.scrollCb, r3 = t3.doc, i3 = t3.mirror, n3 = t3.blockClass, s3 = t3.blockSelector, a3 = t3.sampling, o3 = /* @__PURE__ */ new Map(), u3 = (t4) => {
        var a4 = Zt2(t4);
        if (a4 && !xt2(a4, n3, s3, true)) {
          var u4, l4, h3 = i3.getId(a4);
          if (a4 === r3 && r3.defaultView) {
            var d3 = St2(r3.defaultView);
            u4 = d3.left, l4 = d3.top;
          } else u4 = a4.scrollLeft, l4 = a4.scrollTop;
          var c3 = u4 + "," + l4;
          o3.get(h3) !== c3 && (o3.set(h3, c3), e3({ id: h3, x: u4, y: l4 }));
        }
      }, l3 = [pt2("scroll", Gt2(bt2(Gt2((t4) => u3(t4)), a3.scroll || 100)), r3)];
      return "onscrollend" in r3 && l3.push(pt2("scrollend", Gt2(u3), r3)), () => l3.forEach((t4) => t4());
    }
    function Xt2(t3, e3) {
      for (var r3 = Vt2.length - 1; r3 >= 0; r3--) {
        var i3 = Vt2[r3];
        if (i3) {
          var n3 = i3.bufferBelongsToIframe(t3);
          !n3 && e3 && e3.has(i3.bufferDoc()) && (n3 = true), n3 && (i3.reset(), Vt2.splice(r3, 1));
        }
      }
    }
    var Kt2 = ["INPUT", "TEXTAREA", "SELECT"], Yt2 = /* @__PURE__ */ new WeakMap();
    function te2(t3) {
      return function t4(e3, r3) {
        if (ne2("CSSGroupingRule") && e3.parentRule instanceof CSSGroupingRule || ne2("CSSMediaRule") && e3.parentRule instanceof CSSMediaRule || ne2("CSSSupportsRule") && e3.parentRule instanceof CSSSupportsRule || ne2("CSSConditionRule") && e3.parentRule instanceof CSSConditionRule) {
          var i3 = Array.from(e3.parentRule.cssRules).indexOf(e3);
          return r3.unshift(i3), t4(e3.parentRule, r3);
        }
        if (e3.parentStyleSheet) {
          var n3 = Array.from(e3.parentStyleSheet.cssRules).indexOf(e3);
          r3.unshift(n3);
        }
        return r3;
      }(t3, []);
    }
    function ee2(t3, e3, r3) {
      var i3, n3;
      return t3 ? (t3.ownerNode ? i3 = e3.getId(t3.ownerNode) : n3 = r3.getId(t3), { styleId: n3, id: i3 }) : {};
    }
    function re2(t3, e3) {
      var r3, i3, n3, s3, a3 = t3.stylesheetManager;
      s3 = t3.mirror.getId("#document" === e3.nodeName ? e3 : I2.host(e3));
      var o3 = "#document" === e3.nodeName ? null == (r3 = e3.defaultView) ? void 0 : r3.Document : null == (n3 = null == (i3 = e3.ownerDocument) ? void 0 : i3.defaultView) ? void 0 : n3.ShadowRoot, u3 = (null == o3 ? void 0 : o3.prototype) ? Object.getOwnPropertyDescriptor(null == o3 ? void 0 : o3.prototype, "adoptedStyleSheets") : void 0;
      return null !== s3 && -1 !== s3 && o3 && u3 ? (Object.defineProperty(e3, "adoptedStyleSheets", { configurable: u3.configurable, enumerable: u3.enumerable, get() {
        var t4;
        return null == (t4 = u3.get) ? void 0 : t4.call(this);
      }, set(t4) {
        var e4, r4;
        try {
          r4 = null == (e4 = u3.set) ? void 0 : e4.call(this, t4);
        } catch (t5) {
          if (t5 && "object" == typeof t5 && "NotAllowedError" === t5.name) return;
          throw t5;
        }
        if (null !== s3 && -1 !== s3) try {
          a3.adoptStyleSheets(t4, s3);
        } catch (t5) {
        }
        return r4;
      } }), Gt2(() => {
        Object.defineProperty(e3, "adoptedStyleSheets", { configurable: u3.configurable, enumerable: u3.enumerable, get: u3.get, set: u3.set });
      })) : () => {
      };
    }
    function ie2(t3, e3) {
      void 0 === e3 && (e3 = {});
      var i3, n3, s3 = t3.doc.defaultView;
      if (!s3) return () => {
      };
      if (function(t4, e4) {
        var r3 = t4.mutationCb, i4 = t4.mousemoveCb, n4 = t4.mouseInteractionCb, s4 = t4.scrollCb, a4 = t4.viewportResizeCb, o4 = t4.inputCb, u3 = t4.mediaInteractionCb, l3 = t4.styleSheetRuleCb, h3 = t4.styleDeclarationCb, d4 = t4.canvasMutationCb, c3 = t4.fontCb, v4 = t4.selectionCb, f4 = t4.customElementCb;
        t4.mutationCb = function() {
          e4.mutation && e4.mutation(...arguments), r3(...arguments);
        }, t4.mousemoveCb = function() {
          e4.mousemove && e4.mousemove(...arguments), i4(...arguments);
        }, t4.mouseInteractionCb = function() {
          e4.mouseInteraction && e4.mouseInteraction(...arguments), n4(...arguments);
        }, t4.scrollCb = function() {
          e4.scroll && e4.scroll(...arguments), s4(...arguments);
        }, t4.viewportResizeCb = function() {
          e4.viewportResize && e4.viewportResize(...arguments), a4(...arguments);
        }, t4.inputCb = function() {
          e4.input && e4.input(...arguments), o4(...arguments);
        }, t4.mediaInteractionCb = function() {
          e4.mediaInteaction && e4.mediaInteaction(...arguments), u3(...arguments);
        }, t4.styleSheetRuleCb = function() {
          e4.styleSheetRule && e4.styleSheetRule(...arguments), l3(...arguments);
        }, t4.styleDeclarationCb = function() {
          e4.styleDeclaration && e4.styleDeclaration(...arguments), h3(...arguments);
        }, t4.canvasMutationCb = function() {
          e4.canvasMutation && e4.canvasMutation(...arguments), d4(...arguments);
        }, t4.fontCb = function() {
          e4.font && e4.font(...arguments), c3(...arguments);
        }, t4.selectionCb = function() {
          e4.selection && e4.selection(...arguments), v4(...arguments);
        }, t4.customElementCb = function() {
          e4.customElement && e4.customElement(...arguments), f4(...arguments);
        };
      }(t3, e3), t3.recordDOM) {
        var a3 = Jt2(t3, t3.doc);
        i3 = a3.observer, n3 = a3.buffer;
      }
      var o3, d3, v3, f3, p3, m3, g3, y3, w3, b3 = function(t4) {
        var e4 = t4.mousemoveCb, r3 = t4.sampling, i4 = t4.doc, n4 = t4.mirror;
        if (false === r3.mousemove) return () => {
        };
        var s4, a4 = "number" == typeof r3.mousemove ? r3.mousemove : 50, o4 = "number" == typeof r3.mousemoveCallback ? r3.mousemoveCallback : 500, l3 = [], h3 = bt2(Gt2((t5) => {
          var r4 = Date.now() - s4;
          e4(l3.map((t6) => (t6.timeOffset -= r4, t6)), t5), l3 = [], s4 = null;
        }), o4), d4 = Gt2(bt2(Gt2((t5) => {
          var e5 = Zt2(t5), r4 = Ot2(t5) ? t5.changedTouches[0] : t5, i5 = r4.clientX, a5 = r4.clientY;
          s4 || (s4 = _t2()), l3.push({ x: i5, y: a5, id: n4.getId(e5), timeOffset: _t2() - s4 }), h3("undefined" != typeof DragEvent && t5 instanceof DragEvent ? u2.Drag : t5 instanceof MouseEvent ? u2.MouseMove : u2.TouchMove);
        }), a4, { trailing: false })), c3 = [pt2("mousemove", d4, i4), pt2("touchmove", d4, i4), pt2("drag", d4, i4)];
        return Gt2(() => {
          c3.forEach((t5) => t5());
        });
      }(t3), k3 = function(t4) {
        var e4 = t4.mouseInteractionCb, i4 = t4.doc, n4 = t4.mirror, s4 = t4.blockClass, a4 = t4.blockSelector, o4 = t4.sampling;
        if (false === o4.mouseInteraction) return () => {
        };
        var u3 = true === o4.mouseInteraction || void 0 === o4.mouseInteraction ? {} : o4.mouseInteraction, d4 = [], c3 = null;
        return Object.keys(l2).filter((t5) => Number.isNaN(Number(t5)) && !t5.endsWith("_Departed") && false !== u3[t5]).forEach((t5) => {
          var o5 = E2(t5), u4 = /* @__PURE__ */ ((t6) => (i5) => {
            var o6 = Zt2(i5);
            if (!xt2(o6, s4, a4, true)) {
              var u5 = null, d5 = t6;
              if ("pointerType" in i5) {
                switch (i5.pointerType) {
                  case "mouse":
                    u5 = h2.Mouse;
                    break;
                  case "touch":
                    u5 = h2.Touch;
                    break;
                  case "pen":
                    u5 = h2.Pen;
                }
                u5 === h2.Touch && (l2[t6] === l2.MouseDown ? d5 = "TouchStart" : l2[t6] === l2.MouseUp && (d5 = "TouchEnd"));
              } else Ot2(i5) && (u5 = h2.Touch);
              null !== u5 ? (c3 = u5, (d5.startsWith("Touch") && u5 === h2.Touch || d5.startsWith("Mouse") && u5 === h2.Mouse) && (u5 = null)) : l2[t6] === l2.Click && (u5 = c3, c3 = null);
              var v4 = Ot2(i5) ? i5.changedTouches[0] : i5;
              if (v4) {
                var f4 = n4.getId(o6), p4 = v4.clientX, m4 = v4.clientY;
                Gt2(e4)(r2({ type: l2[d5], id: f4, x: p4, y: m4 }, null !== u5 && { pointerType: u5 }));
              }
            }
          })(t5);
          if (window.PointerEvent) switch (l2[t5]) {
            case l2.MouseDown:
            case l2.MouseUp:
              o5 = o5.replace("mouse", "pointer");
              break;
            case l2.TouchStart:
            case l2.TouchEnd:
              return;
          }
          d4.push(pt2(o5, u4, i4));
        }), Gt2(() => {
          d4.forEach((t5) => t5());
        });
      }(t3), _3 = Qt2(t3), M3 = function(t4, e4) {
        var r3 = t4.viewportResizeCb, i4 = e4.win, n4 = -1, s4 = -1;
        return pt2("resize", Gt2(bt2(Gt2(() => {
          var t5 = It2(), e5 = Mt2();
          n4 === t5 && s4 === e5 || (r3({ width: Number(e5), height: Number(t5) }), n4 = t5, s4 = e5);
        }), 200)), i4);
      }(t3, { win: s3 }), C3 = function(t4) {
        var e4 = t4.inputCb, i4 = t4.doc, n4 = t4.mirror, s4 = t4.blockClass, a4 = t4.blockSelector, o4 = t4.ignoreClass, u3 = t4.ignoreSelector, l3 = t4.maskInputOptions, h3 = t4.maskInputFn, d4 = t4.userTriggeredOnInput;
        function c3(t5) {
          var e5 = Zt2(t5), r3 = t5.isTrusted, n5 = i4.defaultView;
          if (!e5 || !n5 || e5 instanceof n5.HTMLElement) {
            var c4 = e5 && e5.tagName;
            if (e5 && "OPTION" === c4 && (e5 = I2.parentElement(e5)), e5 && c4 && Kt2.indexOf(c4) >= 0 && !xt2(e5, s4, a4, true) && !(e5.classList.contains(o4) || u3 && e5.matches(u3))) {
              var f5 = e5.value, p5 = false, m5 = L2(e5) || "";
              "radio" === m5 || "checkbox" === m5 ? p5 = e5.checked : (l3[c4.toLowerCase()] || l3[m5]) && (f5 = A2({ element: e5, maskInputOptions: l3, tagName: c4, type: m5, value: f5, maskInputFn: h3 })), v4(e5, d4 ? { text: f5, isChecked: p5, userTriggered: r3 } : { text: f5, isChecked: p5 });
              var g4 = e5.name;
              "radio" === m5 && g4 && p5 && i4.querySelectorAll('input[type="radio"][name="' + g4 + '"]').forEach((t6) => {
                if (t6 !== e5) {
                  var r4 = t6.value;
                  v4(t6, d4 ? { text: r4, isChecked: !p5, userTriggered: false } : { text: r4, isChecked: !p5 });
                }
              });
            }
          }
        }
        function v4(t5, i5) {
          var s5 = Yt2.get(t5);
          if (!s5 || s5.text !== i5.text || s5.isChecked !== i5.isChecked) {
            Yt2.set(t5, i5);
            var a5 = n4.getId(t5);
            Gt2(e4)(r2({}, i5, { id: a5 }));
          }
        }
        var f4 = ("last" === t4.sampling.input ? ["change"] : ["input", "change"]).map((t5) => pt2(t5, Gt2(c3), i4)), p4 = i4.defaultView;
        if (!p4) return () => {
          f4.forEach((t5) => t5());
        };
        var m4 = p4.Object.getOwnPropertyDescriptor(p4.HTMLInputElement.prototype, "value");
        return m4 && m4.set && f4.push(...[[p4.HTMLInputElement.prototype, "value"], [p4.HTMLInputElement.prototype, "checked"], [p4.HTMLSelectElement.prototype, "value"], [p4.HTMLTextAreaElement.prototype, "value"], [p4.HTMLSelectElement.prototype, "selectedIndex"], [p4.HTMLOptionElement.prototype, "selected"]].map((t5) => kt2(t5[0], t5[1], { set() {
          Gt2(c3)({ target: this, isTrusted: false });
        } }, false, p4))), Gt2(() => {
          f4.forEach((t5) => t5());
        });
      }(t3), x3 = (d3 = (o3 = t3).mediaInteractionCb, v3 = o3.blockClass, f3 = o3.blockSelector, p3 = o3.mirror, m3 = o3.sampling, g3 = o3.doc, y3 = Gt2((t4) => bt2(Gt2((e4) => {
        var r3 = Zt2(e4);
        if (r3 && !xt2(r3, v3, f3, true)) {
          var i4 = r3.currentTime, n4 = r3.volume, s4 = r3.muted, a4 = r3.playbackRate, o4 = r3.loop;
          d3({ type: t4, id: p3.getId(r3), currentTime: i4, volume: n4, muted: s4, playbackRate: a4, loop: o4 });
        }
      }), m3.media || 500)), w3 = [pt2("play", y3(c2.Play), g3), pt2("pause", y3(c2.Pause), g3), pt2("seeked", y3(c2.Seeked), g3), pt2("volumechange", y3(c2.VolumeChange), g3), pt2("ratechange", y3(c2.RateChange), g3)], Gt2(() => {
        w3.forEach((t4) => t4());
      })), R3 = () => {
      }, T3 = () => {
      }, O3 = () => {
      }, N3 = () => {
      };
      t3.recordDOM && (R3 = function(t4, e4) {
        var r3 = t4.styleSheetRuleCb, i4 = t4.mirror, n4 = t4.stylesheetManager, s4 = e4.win;
        if (!s4.CSSStyleSheet || !s4.CSSStyleSheet.prototype) return () => {
        };
        var a4 = s4.CSSStyleSheet.prototype.insertRule;
        s4.CSSStyleSheet.prototype.insertRule = new Proxy(a4, { apply: Gt2((t5, e5, s5) => {
          var a5 = s5[0], o5 = s5[1], u4 = ee2(e5, i4, n4.styleMirror), l4 = u4.id, h4 = u4.styleId;
          return (l4 && -1 !== l4 || h4 && -1 !== h4) && r3({ id: l4, styleId: h4, adds: [{ rule: a5, index: o5 }] }), t5.apply(e5, s5);
        }) }), s4.CSSStyleSheet.prototype.addRule = function(t5, e5, r4) {
          return void 0 === r4 && (r4 = this.cssRules.length), s4.CSSStyleSheet.prototype.insertRule.apply(this, [t5 + " { " + e5 + " }", r4]);
        };
        var o4, u3, l3 = s4.CSSStyleSheet.prototype.deleteRule;
        s4.CSSStyleSheet.prototype.deleteRule = new Proxy(l3, { apply: Gt2((t5, e5, s5) => {
          var a5 = s5[0], o5 = ee2(e5, i4, n4.styleMirror), u4 = o5.id, l4 = o5.styleId;
          return (u4 && -1 !== u4 || l4 && -1 !== l4) && r3({ id: u4, styleId: l4, removes: [{ index: a5 }] }), t5.apply(e5, s5);
        }) }), s4.CSSStyleSheet.prototype.removeRule = function(t5) {
          return s4.CSSStyleSheet.prototype.deleteRule.apply(this, [t5]);
        }, s4.CSSStyleSheet.prototype.replace && (o4 = s4.CSSStyleSheet.prototype.replace, s4.CSSStyleSheet.prototype.replace = new Proxy(o4, { apply: Gt2((t5, e5, s5) => {
          var a5 = s5[0], o5 = ee2(e5, i4, n4.styleMirror), u4 = o5.id, l4 = o5.styleId;
          return (u4 && -1 !== u4 || l4 && -1 !== l4) && r3({ id: u4, styleId: l4, replace: a5 }), t5.apply(e5, s5);
        }) })), s4.CSSStyleSheet.prototype.replaceSync && (u3 = s4.CSSStyleSheet.prototype.replaceSync, s4.CSSStyleSheet.prototype.replaceSync = new Proxy(u3, { apply: Gt2((t5, e5, s5) => {
          var a5 = s5[0], o5 = ee2(e5, i4, n4.styleMirror), u4 = o5.id, l4 = o5.styleId;
          return (u4 && -1 !== u4 || l4 && -1 !== l4) && r3({ id: u4, styleId: l4, replaceSync: a5 }), t5.apply(e5, s5);
        }) }));
        var h3 = {};
        se2("CSSGroupingRule") ? h3.CSSGroupingRule = s4.CSSGroupingRule : (se2("CSSMediaRule") && (h3.CSSMediaRule = s4.CSSMediaRule), se2("CSSConditionRule") && (h3.CSSConditionRule = s4.CSSConditionRule), se2("CSSSupportsRule") && (h3.CSSSupportsRule = s4.CSSSupportsRule));
        var d4 = {};
        return Object.entries(h3).forEach((t5) => {
          var e5 = t5[0], s5 = t5[1];
          d4[e5] = { insertRule: s5.prototype.insertRule, deleteRule: s5.prototype.deleteRule }, s5.prototype.insertRule = new Proxy(d4[e5].insertRule, { apply: Gt2((t6, e6, s6) => {
            var a5 = s6[0], o5 = s6[1], u4 = ee2(e6.parentStyleSheet, i4, n4.styleMirror), l4 = u4.id, h4 = u4.styleId;
            return (l4 && -1 !== l4 || h4 && -1 !== h4) && r3({ id: l4, styleId: h4, adds: [{ rule: a5, index: [...te2(e6), o5 || 0] }] }), t6.apply(e6, s6);
          }) }), s5.prototype.deleteRule = new Proxy(d4[e5].deleteRule, { apply: Gt2((t6, e6, s6) => {
            var a5 = s6[0], o5 = ee2(e6.parentStyleSheet, i4, n4.styleMirror), u4 = o5.id, l4 = o5.styleId;
            return (u4 && -1 !== u4 || l4 && -1 !== l4) && r3({ id: u4, styleId: l4, removes: [{ index: [...te2(e6), a5] }] }), t6.apply(e6, s6);
          }) });
        }), Gt2(() => {
          s4.CSSStyleSheet.prototype.insertRule = a4, s4.CSSStyleSheet.prototype.deleteRule = l3, o4 && (s4.CSSStyleSheet.prototype.replace = o4), u3 && (s4.CSSStyleSheet.prototype.replaceSync = u3), Object.entries(h3).forEach((t5) => {
            var e5 = t5[0], r4 = t5[1];
            r4.prototype.insertRule = d4[e5].insertRule, r4.prototype.deleteRule = d4[e5].deleteRule;
          });
        });
      }(t3, { win: s3 }), T3 = re2(t3, t3.doc), O3 = function(t4, e4) {
        var r3 = t4.styleDeclarationCb, i4 = t4.mirror, n4 = t4.ignoreCSSAttributes, s4 = t4.stylesheetManager, a4 = e4.win, o4 = a4.CSSStyleDeclaration.prototype.setProperty;
        a4.CSSStyleDeclaration.prototype.setProperty = new Proxy(o4, { apply: Gt2((t5, e5, a5) => {
          var u4, l3 = a5[0], h3 = a5[1], d4 = a5[2];
          if (n4.has(l3)) return o4.apply(e5, [l3, h3, d4]);
          var c3 = ee2(null == (u4 = e5.parentRule) ? void 0 : u4.parentStyleSheet, i4, s4.styleMirror), v4 = c3.id, f4 = c3.styleId;
          return (v4 && -1 !== v4 || f4 && -1 !== f4) && r3({ id: v4, styleId: f4, set: { property: l3, value: h3, priority: d4 }, index: te2(e5.parentRule) }), t5.apply(e5, a5);
        }) });
        var u3 = a4.CSSStyleDeclaration.prototype.removeProperty;
        return a4.CSSStyleDeclaration.prototype.removeProperty = new Proxy(u3, { apply: Gt2((t5, e5, a5) => {
          var o5, l3 = a5[0];
          if (n4.has(l3)) return u3.apply(e5, [l3]);
          var h3 = ee2(null == (o5 = e5.parentRule) ? void 0 : o5.parentStyleSheet, i4, s4.styleMirror), d4 = h3.id, c3 = h3.styleId;
          return (d4 && -1 !== d4 || c3 && -1 !== c3) && r3({ id: d4, styleId: c3, remove: { property: l3 }, index: te2(e5.parentRule) }), t5.apply(e5, a5);
        }) }), Gt2(() => {
          a4.CSSStyleDeclaration.prototype.setProperty = o4, a4.CSSStyleDeclaration.prototype.removeProperty = u3;
        });
      }(t3, { win: s3 }), t3.collectFonts && (N3 = function(t4) {
        var e4 = t4.fontCb, r3 = t4.doc, i4 = r3.defaultView;
        if (!i4) return () => {
        };
        var n4 = [], s4 = /* @__PURE__ */ new WeakMap(), a4 = i4.FontFace;
        i4.FontFace = function(t5, e5, r4) {
          var i5 = new a4(t5, e5, r4);
          return s4.set(i5, { family: t5, buffer: "string" != typeof e5, descriptors: r4, fontSource: "string" == typeof e5 ? e5 : JSON.stringify(Array.from(new Uint8Array(e5))) }), i5;
        };
        var o4 = S2(r3.fonts, "add", function(t5) {
          return function(r4) {
            return setTimeout(Gt2(() => {
              var t6 = s4.get(r4);
              t6 && (e4(t6), s4.delete(r4));
            }), 0), t5.apply(this, [r4]);
          };
        });
        return n4.push(() => {
          i4.FontFace = a4;
        }), n4.push(o4), Gt2(() => {
          n4.forEach((t5) => t5());
        });
      }(t3)));
      var F3 = function(t4) {
        var e4 = t4.doc, r3 = t4.mirror, i4 = t4.blockClass, n4 = t4.blockSelector, s4 = t4.selectionCb, a4 = true, o4 = Gt2(() => {
          var t5 = e4.getSelection();
          if (!(!t5 || a4 && (null == t5 ? void 0 : t5.isCollapsed))) {
            a4 = t5.isCollapsed || false;
            for (var o5 = [], u3 = t5.rangeCount || 0, l3 = 0; u3 > l3; l3++) {
              var h3 = t5.getRangeAt(l3), d4 = h3.startContainer, c3 = h3.startOffset, v4 = h3.endContainer, f4 = h3.endOffset;
              xt2(d4, i4, n4, true) || xt2(v4, i4, n4, true) || o5.push({ start: r3.getId(d4), startOffset: c3, end: r3.getId(v4), endOffset: f4 });
            }
            s4({ ranges: o5 });
          }
        });
        return o4(), pt2("selectionchange", o4);
      }(t3), D3 = function(t4) {
        var e4 = t4.customElementCb, r3 = t4.doc.defaultView;
        return r3 && r3.customElements ? S2(r3.customElements, "define", function(t5) {
          return function(r4, i4, n4) {
            try {
              e4({ define: { name: r4 } });
            } catch (t6) {
              console.warn("Custom element callback failed for " + r4);
            }
            return t5.apply(this, [r4, i4, n4]);
          };
        }) : () => {
        };
      }(t3), P3 = [];
      for (var W3 of t3.plugins) P3.push(W3.observer(W3.callback, s3, W3.options));
      return Gt2(() => {
        if (n3) {
          n3.destroy(), n3.reset();
          var e4 = Vt2.indexOf(n3);
          -1 !== e4 && Vt2.splice(e4, 1);
        }
        t3.shadowDomManager.resetForDoc(t3.doc), null == i3 || i3.disconnect(), b3(), k3(), _3(), M3(), C3(), x3(), R3(), T3(), O3(), N3(), F3(), D3(), P3.forEach((t4) => t4());
      });
    }
    function ne2(t3) {
      return void 0 !== window[t3];
    }
    function se2(t3) {
      return Boolean(void 0 !== window[t3] && window[t3].prototype && "insertRule" in window[t3].prototype && "deleteRule" in window[t3].prototype);
    }
    class ae2 {
      constructor(t3) {
        a2(this, "iframeIdToRemoteIdMap", /* @__PURE__ */ new WeakMap()), a2(this, "iframeRemoteIdToIdMap", /* @__PURE__ */ new WeakMap()), this.generateIdFn = t3;
      }
      getId(t3, e3, r3, i3) {
        var n3 = r3 || this.getIdToRemoteIdMap(t3), s3 = i3 || this.getRemoteIdToIdMap(t3), a3 = n3.get(e3);
        return a3 || (a3 = this.generateIdFn(), n3.set(e3, a3), s3.set(a3, e3)), a3;
      }
      getIds(t3, e3) {
        var r3 = this.getIdToRemoteIdMap(t3), i3 = this.getRemoteIdToIdMap(t3);
        return e3.map((e4) => this.getId(t3, e4, r3, i3));
      }
      getRemoteId(t3, e3, r3) {
        var i3 = r3 || this.getRemoteIdToIdMap(t3);
        return "number" != typeof e3 ? e3 : i3.get(e3) || -1;
      }
      getRemoteIds(t3, e3) {
        var r3 = this.getRemoteIdToIdMap(t3);
        return e3.map((e4) => this.getRemoteId(t3, e4, r3));
      }
      reset(t3) {
        if (!t3) return this.iframeIdToRemoteIdMap = /* @__PURE__ */ new WeakMap(), void (this.iframeRemoteIdToIdMap = /* @__PURE__ */ new WeakMap());
        this.iframeIdToRemoteIdMap.delete(t3), this.iframeRemoteIdToIdMap.delete(t3);
      }
      getIdToRemoteIdMap(t3) {
        var e3 = this.iframeIdToRemoteIdMap.get(t3);
        return e3 || this.iframeIdToRemoteIdMap.set(t3, e3 = /* @__PURE__ */ new Map()), e3;
      }
      getRemoteIdToIdMap(t3) {
        var e3 = this.iframeRemoteIdToIdMap.get(t3);
        return e3 || this.iframeRemoteIdToIdMap.set(t3, e3 = /* @__PURE__ */ new Map()), e3;
      }
    }
    class oe2 {
      constructor(t3) {
        a2(this, "iframes", /* @__PURE__ */ new WeakMap()), a2(this, "crossOriginIframeMap", /* @__PURE__ */ new WeakMap()), a2(this, "crossOriginIframeMirror", new ae2(Z2)), a2(this, "crossOriginIframeStyleMirror"), a2(this, "crossOriginIframeRootIdMap", /* @__PURE__ */ new WeakMap()), a2(this, "mirror"), a2(this, "mutationCb"), a2(this, "wrappedEmit"), a2(this, "loadListener"), a2(this, "pageHideListener"), a2(this, "stylesheetManager"), a2(this, "recordCrossOriginIframes"), a2(this, "messageHandler"), a2(this, "nestedIframeListeners", /* @__PURE__ */ new Map()), a2(this, "attachedWindows", /* @__PURE__ */ new WeakMap()), a2(this, "attachedDocuments", /* @__PURE__ */ new WeakMap()), a2(this, "attachedIframes", /* @__PURE__ */ new Map()), a2(this, "loadListenerDisposers", /* @__PURE__ */ new WeakMap()), a2(this, "iframeElementsById", /* @__PURE__ */ new Map()), a2(this, "pageHideHandlers", /* @__PURE__ */ new WeakMap()), this.mutationCb = t3.mutationCb, this.wrappedEmit = t3.wrappedEmit, this.stylesheetManager = t3.stylesheetManager, this.recordCrossOriginIframes = t3.recordCrossOriginIframes, this.crossOriginIframeStyleMirror = new ae2(this.stylesheetManager.styleMirror.generateId.bind(this.stylesheetManager.styleMirror)), this.mirror = t3.mirror, this.messageHandler = this.handleMessage.bind(this), this.recordCrossOriginIframes && window.addEventListener("message", this.messageHandler);
      }
      addIframe(t3) {
        this.iframes.set(t3, true), t3.contentWindow && this.crossOriginIframeMap.set(t3.contentWindow, t3);
      }
      registerLoadListenerDisposer(t3, e3) {
        var r3 = this.loadListenerDisposers.get(t3);
        r3 || this.loadListenerDisposers.set(t3, r3 = /* @__PURE__ */ new Set()), r3.add(e3);
        var i3 = this.mirror.getId(t3);
        -1 !== i3 && this.iframeElementsById.set(i3, t3);
      }
      getIframeElementById(t3) {
        var e3, r3, i3;
        return null !== (e3 = null !== (r3 = null == (i3 = this.attachedIframes.get(t3)) ? void 0 : i3.element) && void 0 !== r3 ? r3 : this.iframeElementsById.get(t3)) && void 0 !== e3 ? e3 : null;
      }
      forgetIframeId(t3) {
        this.attachedIframes.delete(t3), this.iframeElementsById.delete(t3);
      }
      disposeLoadListeners(t3) {
        var e3 = this.loadListenerDisposers.get(t3);
        e3 && (e3.forEach((t4) => gt2(t4)), this.loadListenerDisposers.delete(t3));
      }
      removePageHideListener(t3) {
        var e3 = this.pageHideHandlers.get(t3);
        e3 && (e3.forEach((t4) => {
          mt2(t4.win, "pagehide", t4.handler);
        }), this.pageHideHandlers.delete(t3));
      }
      addLoadListener(t3) {
        this.loadListener = t3;
      }
      addPageHideListener(t3) {
        this.pageHideListener = t3;
      }
      removeLoadListener() {
        this.loadListener = void 0;
      }
      trackIframeContent(t3, e3) {
        var r3 = this.mirror.getId(t3);
        return this.attachedIframes.set(r3, { element: t3, content: e3 }), r3;
      }
      attachIframe(t3, e3) {
        var r3, i3 = this.trackIframeContent(t3, e3);
        if (t3.contentDocument) {
          var n3 = this.attachedDocuments.get(t3);
          n3 || this.attachedDocuments.set(t3, n3 = /* @__PURE__ */ new Set()), n3.add(t3.contentDocument);
        }
        this.mutationCb({ adds: [{ parentId: i3, nextId: null, node: e3 }], removes: [], texts: [], attributes: [], isAttachIframe: true });
        var s3 = t3.contentWindow;
        if (this.recordCrossOriginIframes && s3 && !this.nestedIframeListeners.has(s3)) {
          var a3 = this.handleMessage.bind(this);
          gt2(() => {
            s3.addEventListener("message", a3), this.nestedIframeListeners.set(s3, a3);
            var e4 = this.attachedWindows.get(t3);
            e4 || this.attachedWindows.set(t3, e4 = /* @__PURE__ */ new Set()), e4.add(s3);
          });
        }
        gt2(() => {
          var e4 = t3.contentWindow;
          if (e4) {
            var r4 = this.pageHideHandlers.get(t3);
            if (r4) {
              for (var i4 of r4) if (i4.win === e4) return;
            }
            var n4 = () => {
              var e5;
              null == (e5 = this.pageHideListener) || e5.call(this, t3), t3.contentDocument && this.mirror.removeNodeFromMap(t3.contentDocument), t3.contentWindow && this.crossOriginIframeMap.delete(t3.contentWindow);
            };
            e4.addEventListener("pagehide", n4), r4 || this.pageHideHandlers.set(t3, r4 = /* @__PURE__ */ new Set()), r4.add({ win: e4, handler: n4 });
          }
        }), null == (r3 = this.loadListener) || r3.call(this, t3), t3.contentDocument && t3.contentDocument.adoptedStyleSheets && t3.contentDocument.adoptedStyleSheets.length > 0 && this.stylesheetManager.adoptStyleSheets(t3.contentDocument.adoptedStyleSheets, this.mirror.getId(t3.contentDocument));
      }
      handleMessage(t3) {
        var e3 = t3;
        if ("rrweb" === e3.data.type && e3.origin === e3.data.origin && t3.source) {
          var r3 = this.crossOriginIframeMap.get(t3.source);
          if (r3) {
            var i3 = this.transformCrossOriginEvent(r3, e3.data.event);
            i3 && this.wrappedEmit(i3, e3.data.isCheckout);
          }
        }
      }
      transformCrossOriginEvent(t3, e3) {
        var r3;
        switch (e3.type) {
          case o2.FullSnapshot:
            this.crossOriginIframeMirror.reset(t3), this.crossOriginIframeStyleMirror.reset(t3), this.replaceIdOnNode(e3.data.node, t3);
            var i3 = e3.data.node.id;
            return this.crossOriginIframeRootIdMap.set(t3, i3), this.patchRootIdOnNode(e3.data.node, i3), this.trackIframeContent(t3, e3.data.node), { timestamp: e3.timestamp, type: o2.IncrementalSnapshot, data: { source: u2.Mutation, adds: [{ parentId: this.mirror.getId(t3), nextId: null, node: e3.data.node }], removes: [], texts: [], attributes: [], isAttachIframe: true } };
          case o2.Meta:
          case o2.Load:
          case o2.DomContentLoaded:
            return false;
          case o2.Plugin:
            return e3;
          case o2.Custom:
            return this.replaceIds(e3.data.payload, t3, ["id", "parentId", "previousId", "nextId"]), e3;
          case o2.IncrementalSnapshot:
            switch (e3.data.source) {
              case u2.Mutation:
                return e3.data.adds.forEach((e4) => {
                  this.replaceIds(e4, t3, ["parentId", "nextId", "previousId"]), this.replaceIdOnNode(e4.node, t3);
                  var r4 = this.crossOriginIframeRootIdMap.get(t3);
                  r4 && this.patchRootIdOnNode(e4.node, r4);
                }), e3.data.removes.forEach((e4) => {
                  this.replaceIds(e4, t3, ["parentId", "id"]);
                }), e3.data.attributes.forEach((e4) => {
                  this.replaceIds(e4, t3, ["id"]);
                }), e3.data.texts.forEach((e4) => {
                  this.replaceIds(e4, t3, ["id"]);
                }), e3;
              case u2.Drag:
              case u2.TouchMove:
              case u2.MouseMove:
                return e3.data.positions.forEach((e4) => {
                  this.replaceIds(e4, t3, ["id"]);
                }), e3;
              case u2.ViewportResize:
                return false;
              case u2.MediaInteraction:
              case u2.MouseInteraction:
              case u2.Scroll:
              case u2.CanvasMutation:
              case u2.Input:
                return this.replaceIds(e3.data, t3, ["id"]), e3;
              case u2.StyleSheetRule:
              case u2.StyleDeclaration:
                return this.replaceIds(e3.data, t3, ["id"]), this.replaceStyleIds(e3.data, t3, ["styleId"]), e3;
              case u2.Font:
                return e3;
              case u2.Selection:
                return e3.data.ranges.forEach((e4) => {
                  this.replaceIds(e4, t3, ["start", "end"]);
                }), e3;
              case u2.AdoptedStyleSheet:
                return this.replaceIds(e3.data, t3, ["id"]), this.replaceStyleIds(e3.data, t3, ["styleIds"]), null == (r3 = e3.data.styles) || r3.forEach((e4) => {
                  this.replaceStyleIds(e4, t3, ["styleId"]);
                }), e3;
            }
        }
        return false;
      }
      replace(t3, e3, r3, i3) {
        for (var n3 of i3) (Array.isArray(e3[n3]) || "number" == typeof e3[n3]) && (e3[n3] = Array.isArray(e3[n3]) ? t3.getIds(r3, e3[n3]) : t3.getId(r3, e3[n3]));
        return e3;
      }
      replaceIds(t3, e3, r3) {
        return this.replace(this.crossOriginIframeMirror, t3, e3, r3);
      }
      replaceStyleIds(t3, e3, r3) {
        return this.replace(this.crossOriginIframeStyleMirror, t3, e3, r3);
      }
      replaceIdOnNode(t3, e3) {
        this.replaceIds(t3, e3, ["id", "rootId"]), "childNodes" in t3 && t3.childNodes.forEach((t4) => {
          this.replaceIdOnNode(t4, e3);
        });
      }
      patchRootIdOnNode(t3, e3) {
        t3.type === v2.Document || t3.rootId || (t3.rootId = e3), "childNodes" in t3 && t3.childNodes.forEach((t4) => {
          this.patchRootIdOnNode(t4, e3);
        });
      }
      removeIframeById(t3) {
        var e3 = this.attachedIframes.get(t3), r3 = (null == e3 ? void 0 : e3.element) || this.iframeElementsById.get(t3) || this.mirror.getNode(t3);
        if (this.iframeElementsById.delete(t3), r3) {
          var i3 = r3.contentWindow, n3 = this.attachedWindows.get(r3);
          n3 && (n3.forEach((t4) => {
            var e4 = this.nestedIframeListeners.get(t4);
            e4 && (mt2(t4, "message", e4), this.nestedIframeListeners.delete(t4)), this.crossOriginIframeMap.delete(t4);
          }), this.attachedWindows.delete(r3)), i3 && this.nestedIframeListeners.has(i3) && (mt2(i3, "message", this.nestedIframeListeners.get(i3)), this.nestedIframeListeners.delete(i3)), i3 && this.crossOriginIframeMap.delete(i3), this.iframes.delete(r3), this.disposeLoadListeners(r3), this.removePageHideListener(r3);
          var s3 = this.attachedDocuments.get(r3);
          s3 && (s3.forEach((t4) => {
            gt2(() => this.mirror.removeNodeFromMap(t4));
          }), gt2(() => Xt2(r3, s3)), this.attachedDocuments.delete(r3));
        }
        e3 && this.attachedIframes.delete(t3);
      }
      cleanupDetachedIframes() {
        if (0 !== this.attachedIframes.size) {
          var t3 = [];
          this.attachedIframes.forEach((e3, r3) => {
            this.mirror.has(r3) || t3.push(r3);
          }), t3.forEach((t4) => this.removeIframeById(t4));
        }
      }
      reattachIframes() {
        this.attachedIframes.forEach((t3, e3) => {
          var r3 = t3.content;
          this.mirror.has(e3) ? this.mutationCb({ adds: [{ parentId: e3, nextId: null, node: r3 }], removes: [], texts: [], attributes: [], isAttachIframe: true }) : this.attachedIframes.delete(e3);
        });
      }
      destroy() {
        this.recordCrossOriginIframes && mt2(window, "message", this.messageHandler), this.nestedIframeListeners.forEach((t4, e3) => {
          mt2(e3, "message", t4);
        }), this.nestedIframeListeners.clear();
        var t3 = /* @__PURE__ */ new Set();
        this.iframeElementsById.forEach((e3) => t3.add(e3)), this.attachedIframes.forEach((e3) => t3.add(e3.element)), t3.forEach((t4) => {
          this.disposeLoadListeners(t4), this.removePageHideListener(t4);
        }), this.crossOriginIframeMirror.reset(), this.crossOriginIframeStyleMirror.reset(), this.attachedIframes.clear(), this.crossOriginIframeMap = /* @__PURE__ */ new WeakMap(), this.iframes = /* @__PURE__ */ new WeakMap(), this.crossOriginIframeRootIdMap = /* @__PURE__ */ new WeakMap(), this.loadListenerDisposers = /* @__PURE__ */ new WeakMap(), this.pageHideHandlers = /* @__PURE__ */ new WeakMap(), this.attachedDocuments = /* @__PURE__ */ new WeakMap(), this.attachedWindows = /* @__PURE__ */ new WeakMap(), this.iframeElementsById = /* @__PURE__ */ new Map();
      }
    }
    class ue2 {
      constructor(t3) {
        a2(this, "shadowDoms", /* @__PURE__ */ new WeakSet()), a2(this, "mutationCb"), a2(this, "scrollCb"), a2(this, "bypassOptions"), a2(this, "mirror"), a2(this, "restoreHandlers", []), this.mutationCb = t3.mutationCb, this.scrollCb = t3.scrollCb, this.bypassOptions = t3.bypassOptions, this.mirror = t3.mirror, this.init();
      }
      init() {
        this.reset(), this.patchAttachShadow(Element, document);
      }
      addShadowRoot(t3, e3) {
        var i3, n3;
        if (x2(t3) && !this.shadowDoms.has(t3)) {
          this.shadowDoms.add(t3);
          var s3 = null !== (i3 = null == (n3 = I2.host(t3)) ? void 0 : n3.ownerDocument) && void 0 !== i3 ? i3 : e3, a3 = Jt2(r2({}, this.bypassOptions, { doc: s3, mutationCb: this.mutationCb, mirror: this.mirror, shadowDomManager: this }), t3), o3 = a3.observer, u3 = a3.buffer;
          this.restoreHandlers.push({ doc: s3, handler() {
            o3.disconnect(), u3.destroy(), u3.releaseCanvasManager();
            var t4 = Vt2.indexOf(u3);
            -1 !== t4 && Vt2.splice(t4, 1);
          } }), this.restoreHandlers.push({ doc: s3, handler: Qt2(r2({}, this.bypassOptions, { scrollCb: this.scrollCb, doc: t3, mirror: this.mirror })) }), setTimeout(() => {
            t3.adoptedStyleSheets && t3.adoptedStyleSheets.length > 0 && this.bypassOptions.stylesheetManager.adoptStyleSheets(t3.adoptedStyleSheets, this.mirror.getId(I2.host(t3))), this.restoreHandlers.push({ doc: s3, handler: re2({ mirror: this.mirror, stylesheetManager: this.bypassOptions.stylesheetManager }, t3) });
          }, 0);
        }
      }
      observeAttachShadow(t3) {
        t3.contentWindow && t3.contentDocument && this.patchAttachShadow(t3.contentWindow.Element, t3.contentDocument);
      }
      patchAttachShadow(t3, e3) {
        var r3 = this;
        this.restoreHandlers.push({ doc: e3, handler: S2(t3.prototype, "attachShadow", function(t4) {
          return function(i3) {
            var n3 = t4.call(this, i3), s3 = I2.shadowRoot(this);
            return s3 && Dt2(this) && r3.addShadowRoot(s3, e3), n3;
          };
        }) });
      }
      reset() {
        this.restoreHandlers.forEach((t3) => {
          var e3 = t3.handler;
          try {
            e3();
          } catch (t4) {
          }
        }), this.restoreHandlers = [], this.shadowDoms = /* @__PURE__ */ new WeakSet();
      }
      resetForDoc(t3) {
        var e3 = [];
        for (var r3 of this.restoreHandlers) if (r3.doc === t3) try {
          r3.handler();
        } catch (t4) {
        }
        else e3.push(r3);
        this.restoreHandlers = e3;
      }
    }
    for (var le2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", he2 = "undefined" == typeof Uint8Array ? [] : new Uint8Array(256), de2 = 0; 64 > de2; de2++) he2[le2.charCodeAt(de2)] = de2;
    var ce2 = /* @__PURE__ */ new Map(), ve2 = (t3, e3, r3) => {
      if (t3 && (me2(t3, e3) || "object" == typeof t3)) {
        var i3 = function(t4, e4) {
          var r4 = ce2.get(t4);
          return r4 || ce2.set(t4, r4 = /* @__PURE__ */ new Map()), r4.has(e4) || r4.set(e4, []), r4.get(e4);
        }(r3, t3.constructor.name), n3 = i3.indexOf(t3);
        return -1 === n3 && (n3 = i3.length, i3.push(t3)), n3;
      }
    };
    function fe2(t3, e3, r3, i3) {
      if (t3 instanceof Array) return t3.map((t4) => fe2(t4, e3, r3, i3));
      if (null === t3) return t3;
      if (t3 instanceof Float32Array || t3 instanceof Float64Array || t3 instanceof Int32Array || t3 instanceof Uint32Array || t3 instanceof Uint8Array || t3 instanceof Uint16Array || t3 instanceof Int16Array || t3 instanceof Int8Array || t3 instanceof Uint8ClampedArray) return { rr_type: t3.constructor.name, args: [Object.values(t3)] };
      if (t3 instanceof ArrayBuffer) {
        var n3 = t3.constructor.name, s3 = function(t4) {
          var e4, r4 = new Uint8Array(t4), i4 = r4.length, n4 = "";
          for (e4 = 0; i4 > e4; e4 += 3) n4 += le2[r4[e4] >> 2], n4 += le2[(3 & r4[e4]) << 4 | r4[e4 + 1] >> 4], n4 += le2[(15 & r4[e4 + 1]) << 2 | r4[e4 + 2] >> 6], n4 += le2[63 & r4[e4 + 2]];
          return i4 % 3 == 2 ? n4 = n4.substring(0, n4.length - 1) + "=" : i4 % 3 == 1 && (n4 = n4.substring(0, n4.length - 2) + "=="), n4;
        }(t3);
        return { rr_type: n3, base64: s3 };
      }
      return t3 instanceof DataView ? { rr_type: t3.constructor.name, args: [fe2(t3.buffer, e3, r3, i3), t3.byteOffset, t3.byteLength] } : t3 instanceof HTMLImageElement ? { rr_type: t3.constructor.name, src: t3.src } : t3 instanceof HTMLCanvasElement ? { rr_type: "HTMLImageElement", src: t3.toDataURL(i3.type, i3.quality) } : t3 instanceof ImageData ? { rr_type: t3.constructor.name, args: [fe2(t3.data, e3, r3, i3), t3.width, t3.height] } : me2(t3, e3) || "object" == typeof t3 ? { rr_type: t3.constructor.name, index: ve2(t3, e3, r3) } : t3;
    }
    var pe2 = (t3, e3, r3, i3) => t3.map((t4) => fe2(t4, e3, r3, i3)), me2 = (t3, e3) => {
      var r3 = ["WebGLActiveInfo", "WebGLBuffer", "WebGLFramebuffer", "WebGLProgram", "WebGLRenderbuffer", "WebGLShader", "WebGLShaderPrecisionFormat", "WebGLTexture", "WebGLUniformLocation", "WebGLVertexArrayObject", "WebGLVertexArrayObjectOES"].filter((t4) => "function" == typeof e3[t4]);
      return Boolean(r3.find((r4) => t3 instanceof e3[r4]));
    }, ge2 = ["webgl", "webgl2"];
    function ye2(t3) {
      return "nodeType" in t3;
    }
    function we2(t3, e3, i3, n3) {
      var s3 = [];
      try {
        if (n3) {
          var a3 = function(t4, e4, i4) {
            var n4 = t4.GPUCanvasContext;
            if ((null == n4 ? void 0 : n4.prototype) && "function" == typeof n4.prototype.configure) return S2(n4.prototype, "configure", function(n5) {
              return function(s4) {
                var a4 = function(t5) {
                  var e5 = t5.canvas;
                  return e5 && "object" == typeof e5 ? e5 : null;
                }(this);
                if (!a4 || ye2(a4) && xt2(a4, e4, i4, true)) return n5.call(this, s4);
                ye2(a4) && !("__context" in a4) && (a4.__context = "webgpu");
                var o4 = function(t5) {
                  var e5 = t5.GPUTextureUsage;
                  return e5 ? e5.COPY_SRC | e5.RENDER_ATTACHMENT : null;
                }(t4);
                return n5.call(this, null !== o4 && s4 ? r2({}, s4, { usage: "number" == typeof s4.usage ? s4.usage | o4 : o4 }) : s4);
              };
            });
          }(t3, e3, i3);
          a3 && s3.push(a3);
        }
        var o3 = S2(t3.HTMLCanvasElement.prototype, "getContext", function(t4) {
          return function(r3) {
            for (var s4 = /* @__PURE__ */ function(t5) {
              return "experimental-webgl" === t5 ? "webgl" : t5;
            }(r3), a4 = arguments.length, o4 = new Array(a4 > 1 ? a4 - 1 : 0), u3 = 1; a4 > u3; u3++) o4[u3 - 1] = arguments[u3];
            if (!xt2(this, e3, i3, true) && ("__context" in this || (this.__context = s4), n3 && ge2.includes(s4))) if (o4[0] && "object" == typeof o4[0]) {
              var l3 = o4[0];
              l3.preserveDrawingBuffer || (l3.preserveDrawingBuffer = true);
            } else o4.splice(0, 1, { preserveDrawingBuffer: true });
            return t4.apply(this, [r3, ...o4]);
          };
        });
        s3.push(o3);
      } catch (t4) {
        console.error("failed to patch HTMLCanvasElement.prototype.getContext");
      }
      return () => {
        s3.forEach((t4) => t4());
      };
    }
    function be2(t3, e3, r3, i3, n3, s3, a3) {
      var o3 = [], u3 = Object.getOwnPropertyNames(t3), l3 = function(u4) {
        if (["isContextLost", "canvas", "drawingBufferWidth", "drawingBufferHeight"].includes(u4)) return 0;
        try {
          if ("function" != typeof t3[u4]) return 0;
          var l4 = S2(t3, u4, function(t4) {
            return function() {
              for (var o4 = arguments.length, l5 = new Array(o4), h5 = 0; o4 > h5; h5++) l5[h5] = arguments[h5];
              var d3 = t4.apply(this, l5);
              if (ve2(d3, s3, this), "tagName" in this.canvas && !xt2(this.canvas, i3, n3, true)) {
                var c3 = pe2(l5, s3, this, a3);
                r3(this.canvas, { type: e3, property: u4, args: c3 });
              }
              return d3;
            };
          });
          o3.push(l4);
        } catch (i4) {
          var h4 = kt2(t3, u4, { set(t4) {
            r3(this.canvas, { type: e3, property: u4, args: [t4], setter: true });
          } });
          o3.push(h4);
        }
      };
      for (var h3 of u3) l3(h3);
      return o3;
    }
    var ke2, _e2, Se2, Ie2 = '(function() {\n  "use strict";\n  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";\n  var lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);\n  for (var i = 0; i < chars.length; i++) {\n    lookup[chars.charCodeAt(i)] = i;\n  }\n  var encode = function(arraybuffer) {\n    var bytes = new Uint8Array(arraybuffer), i2, len = bytes.length, base64 = "";\n    for (i2 = 0; i2 < len; i2 += 3) {\n      base64 += chars[bytes[i2] >> 2];\n      base64 += chars[(bytes[i2] & 3) << 4 | bytes[i2 + 1] >> 4];\n      base64 += chars[(bytes[i2 + 1] & 15) << 2 | bytes[i2 + 2] >> 6];\n      base64 += chars[bytes[i2 + 2] & 63];\n    }\n    if (len % 3 === 2) {\n      base64 = base64.substring(0, base64.length - 1) + "=";\n    } else if (len % 3 === 1) {\n      base64 = base64.substring(0, base64.length - 2) + "==";\n    }\n    return base64;\n  };\n  const lastFingerprintMap = /* @__PURE__ */ new Map();\n  const transparentFingerprintMap = /* @__PURE__ */ new Map();\n  function hashPixels(data) {\n    const view = new Uint32Array(\n      data.buffer,\n      data.byteOffset,\n      data.byteLength >>> 2\n    );\n    let primaryHash = 2166136261;\n    let secondaryHash = 2654435769;\n    for (let i2 = 0; i2 < view.length; i2++) {\n      primaryHash ^= view[i2];\n      primaryHash = Math.imul(primaryHash, 16777619);\n      secondaryHash ^= view[i2];\n      secondaryHash = Math.imul(secondaryHash, 2246822507);\n    }\n    return `${(primaryHash >>> 0).toString(16)}:${(secondaryHash >>> 0).toString(16)}`;\n  }\n  function frameFingerprint(width, height, data) {\n    return `${width}x${height}:${hashPixels(data)}`;\n  }\n  function transparentFingerprint(width, height) {\n    const pixelCount = width * height;\n    let hash = transparentFingerprintMap.get(pixelCount);\n    if (hash === void 0) {\n      hash = hashPixels(new Uint8ClampedArray(pixelCount * 4));\n      transparentFingerprintMap.set(pixelCount, hash);\n    }\n    return `${width}x${height}:${hash}`;\n  }\n  const worker = self;\n  let reusableCanvas = null;\n  let reusableCtx = null;\n  worker.onmessage = async function(e) {\n    if ("OffscreenCanvas" in globalThis) {\n      const {\n        id,\n        bitmap,\n        width,\n        height,\n        displayWidth,\n        displayHeight,\n        dataURLOptions\n      } = e.data;\n      try {\n        if (!reusableCanvas || reusableCanvas.width !== width || reusableCanvas.height !== height) {\n          reusableCanvas = new OffscreenCanvas(width, height);\n          reusableCtx = reusableCanvas.getContext("2d", {\n            willReadFrequently: true\n          });\n        }\n        const ctx = reusableCtx;\n        ctx.clearRect(0, 0, width, height);\n        ctx.drawImage(bitmap, 0, 0);\n        bitmap.close();\n        const fingerprint = frameFingerprint(\n          width,\n          height,\n          ctx.getImageData(0, 0, width, height).data\n        );\n        const lastFingerprint = lastFingerprintMap.get(id) ?? transparentFingerprint(width, height);\n        if (fingerprint === lastFingerprint) {\n          return worker.postMessage({ id });\n        }\n        const blob = await reusableCanvas.convertToBlob(dataURLOptions);\n        const arrayBuffer = await blob.arrayBuffer();\n        worker.postMessage({\n          id,\n          type: blob.type,\n          base64: encode(arrayBuffer),\n          // cpu intensive\n          displayWidth,\n          displayHeight\n        });\n        lastFingerprintMap.set(id, fingerprint);\n      } catch {\n        worker.postMessage({ id });\n      }\n    } else {\n      e.data.bitmap.close();\n      return worker.postMessage({ id: e.data.id });\n    }\n  };\n})();\n//# sourceMappingURL=image-bitmap-data-url-worker-CZCeNtwG.js.map\n', Me2 = "undefined" != typeof self && self.Blob && new Blob([Ie2], { type: "text/javascript;charset=utf-8" });
    function Ce2(t3) {
      var e3;
      try {
        if (!(e3 = Me2 && (self.URL || self.webkitURL).createObjectURL(Me2))) throw "";
        var r3 = new Worker(e3, { name: null == t3 ? void 0 : t3.name });
        return r3.addEventListener("error", () => {
          (self.URL || self.webkitURL).revokeObjectURL(e3);
        }), r3;
      } catch (e4) {
        return new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(Ie2), { name: null == t3 ? void 0 : t3.name });
      } finally {
        e3 && (self.URL || self.webkitURL).revokeObjectURL(e3);
      }
    }
    class xe2 {
      constructor(t3) {
        a2(this, "pendingCanvasMutations", /* @__PURE__ */ new Map()), a2(this, "rafStamps", { latestId: 0, invokeId: null }), a2(this, "mirror"), a2(this, "mutationCb"), a2(this, "resetObservers"), a2(this, "frozen", false), a2(this, "locked", false), a2(this, "rafIdTimestamp", null), a2(this, "rafIdFlush", null), a2(this, "refCount", 0), a2(this, "torndown", false), a2(this, "processMutation", (t4, e4) => {
          !(this.rafStamps.invokeId && this.rafStamps.latestId !== this.rafStamps.invokeId) && this.rafStamps.invokeId || (this.rafStamps.invokeId = this.rafStamps.latestId), this.pendingCanvasMutations.has(t4) || this.pendingCanvasMutations.set(t4, []), this.pendingCanvasMutations.get(t4).push(e4);
        });
        var e3 = t3.sampling, r3 = void 0 === e3 ? "all" : e3, i3 = t3.win, n3 = t3.blockClass, s3 = t3.blockSelector, o3 = t3.recordCanvas, u3 = t3.dataURLOptions, l3 = t3.resolutionScale;
        this.mutationCb = t3.mutationCb, this.mirror = t3.mirror, o3 && "all" === r3 && this.initCanvasMutationObserver(i3, n3, s3, u3), o3 && "number" == typeof r3 && this.initCanvasFPSObserver(r3, i3, n3, s3, { dataURLOptions: u3, resolutionScale: l3 });
      }
      acquire() {
        this.refCount += 1;
      }
      reset() {
        this.refCount > 0 && (this.refCount -= 1), this.refCount > 0 || this.teardown();
      }
      teardown() {
        this.torndown || (this.torndown = true, this.pendingCanvasMutations.clear(), this.resetObservers && this.resetObservers(), null !== this.rafIdTimestamp && (cancelAnimationFrame(this.rafIdTimestamp), this.rafIdTimestamp = null), null !== this.rafIdFlush && (cancelAnimationFrame(this.rafIdFlush), this.rafIdFlush = null));
      }
      freeze() {
        this.frozen = true;
      }
      unfreeze() {
        this.frozen = false;
      }
      lock() {
        this.locked = true;
      }
      unlock() {
        this.locked = false;
      }
      initCanvasFPSObserver(t3, r3, i3, n3, s3) {
        var a3 = this;
        if ("OffscreenCanvas" in r3) {
          var o3, u3 = "number" == typeof s3.resolutionScale && Number.isFinite(s3.resolutionScale) ? Math.min(1, Math.max(0.1, s3.resolutionScale)) : 1, l3 = we2(r3, i3, n3, true), h3 = /* @__PURE__ */ new Map();
          try {
            o3 = new Ce2();
          } catch (t4) {
            return;
          }
          var c3 = false;
          o3.onerror = () => {
            var t4;
            c3 = true, cancelAnimationFrame(v3), null == (t4 = o3.terminate) || t4.call(o3);
          }, o3.onmessage = (t4) => {
            var e3 = t4.data.id;
            if (h3.set(e3, false), "base64" in t4.data) {
              var r4 = t4.data, i4 = r4.displayWidth, n4 = r4.displayHeight;
              this.mutationCb({ id: e3, type: d2["2D"], commands: [{ property: "clearRect", args: [0, 0, i4, n4] }, { property: "drawImage", args: [{ rr_type: "ImageBitmap", args: [{ rr_type: "Blob", data: [{ rr_type: "ArrayBuffer", base64: r4.base64 }], type: r4.type }] }, 0, 0, i4, n4] }], displayWidth: i4, displayHeight: n4 });
            }
          };
          var v3, f3 = 1e3 / t3, p3 = 0, m3 = (t4) => {
            var l4, d3;
            c3 || (p3 && f3 > t4 - p3 || (p3 = t4, (l4 = [], d3 = (t5) => {
              try {
                t5.querySelectorAll("canvas").forEach((t6) => {
                  xt2(t6, i3, n3, true) || l4.push(t6);
                }), t5.querySelectorAll("*").forEach((t6) => {
                  t6.shadowRoot && d3(t6.shadowRoot);
                });
              } catch (t6) {
              }
            }, d3(r3.document), l4).forEach(function() {
              var t5 = e2(function* (t6) {
                var e3, r4, i4 = a3.mirror.getId(t6);
                if (!h3.get(i4) && 0 !== t6.width && 0 !== t6.height) {
                  h3.set(i4, true);
                  try {
                    if (["webgl", "webgl2"].includes(t6.__context)) {
                      var n4 = t6.getContext(t6.__context);
                      if (null == (e3 = null == n4 ? void 0 : n4.isContextLost) ? void 0 : e3.call(n4)) return void h3.set(i4, false);
                      false === (null == (r4 = null == n4 ? void 0 : n4.getContextAttributes()) ? void 0 : r4.preserveDrawingBuffer) && n4.clear(n4.COLOR_BUFFER_BIT);
                    }
                    var l5 = t6.clientWidth || t6.width, d4 = t6.clientHeight || t6.height, c4 = Math.max(1, Math.round(l5 * u3)), v4 = Math.max(1, Math.round(d4 * u3)), f4 = yield createImageBitmap(t6, 1 > u3 ? { resizeWidth: c4, resizeHeight: v4, resizeQuality: "medium" } : { resizeWidth: c4, resizeHeight: v4 });
                    o3.postMessage({ id: i4, bitmap: f4, width: c4, height: v4, displayWidth: l5, displayHeight: d4, dataURLOptions: s3.dataURLOptions }, [f4]);
                  } catch (t7) {
                    h3.set(i4, false);
                  }
                }
              });
              return function(e3) {
                return t5.apply(this, arguments);
              };
            }())), v3 = requestAnimationFrame(m3));
          };
          v3 = requestAnimationFrame(m3), this.resetObservers = () => {
            l3(), cancelAnimationFrame(v3);
          };
        }
      }
      initCanvasMutationObserver(t3, e3, r3, i3) {
        this.startRAFTimestamping(), this.startPendingCanvasMutationFlusher();
        var n3 = we2(t3, e3, r3, false), s3 = function(t4, e4, r4, i4, n4) {
          var s4 = [], a4 = Object.getOwnPropertyNames(e4.CanvasRenderingContext2D.prototype), o3 = function(a5) {
            try {
              if ("function" != typeof e4.CanvasRenderingContext2D.prototype[a5]) return 1;
              var o4 = S2(e4.CanvasRenderingContext2D.prototype, a5, function(s5) {
                return function() {
                  for (var o5 = arguments.length, u5 = new Array(o5), l3 = 0; o5 > l3; l3++) u5[l3] = arguments[l3];
                  return xt2(this.canvas, r4, i4, true) || setTimeout(() => {
                    var r5 = pe2(u5, e4, this, n4);
                    t4(this.canvas, { type: d2["2D"], property: a5, args: r5 });
                  }, 0), s5.apply(this, u5);
                };
              });
              s4.push(o4);
            } catch (r5) {
              var u4 = kt2(e4.CanvasRenderingContext2D.prototype, a5, { set(e5) {
                t4(this.canvas, { type: d2["2D"], property: a5, args: [e5], setter: true });
              } });
              s4.push(u4);
            }
          };
          for (var u3 of a4) o3(u3);
          return () => {
            s4.forEach((t5) => t5());
          };
        }(this.processMutation.bind(this), t3, e3, r3, i3), a3 = function(t4, e4, r4, i4, n4) {
          var s4 = [];
          return void 0 !== e4.WebGLRenderingContext && s4.push(...be2(e4.WebGLRenderingContext.prototype, d2.WebGL, t4, r4, i4, e4, n4)), void 0 !== e4.WebGL2RenderingContext && s4.push(...be2(e4.WebGL2RenderingContext.prototype, d2.WebGL2, t4, r4, i4, e4, n4)), () => {
            s4.forEach((t5) => t5());
          };
        }(this.processMutation.bind(this), t3, e3, r3, i3);
        this.resetObservers = () => {
          n3(), s3(), a3();
        };
      }
      startPendingCanvasMutationFlusher() {
        this.rafIdFlush = requestAnimationFrame(() => this.flushPendingCanvasMutations());
      }
      startRAFTimestamping() {
        var t3 = (e3) => {
          this.rafStamps.latestId = e3, this.rafIdTimestamp = requestAnimationFrame(t3);
        };
        this.rafIdTimestamp = requestAnimationFrame(t3);
      }
      flushPendingCanvasMutations() {
        this.pendingCanvasMutations.forEach((t3, e3) => {
          var r3 = this.mirror.getId(e3);
          this.flushPendingCanvasMutationFor(e3, r3);
        }), this.rafIdFlush = requestAnimationFrame(() => this.flushPendingCanvasMutations());
      }
      flushPendingCanvasMutationFor(t3, e3) {
        if (!this.frozen && !this.locked) {
          var r3 = this.pendingCanvasMutations.get(t3);
          if (r3 && -1 !== e3) {
            var i3 = r3.map((t4) => function(t5, e4) {
              if (null == t5) return {};
              var r4 = {};
              for (var i4 in t5) if ({}.hasOwnProperty.call(t5, i4)) {
                if (-1 !== e4.indexOf(i4)) continue;
                r4[i4] = t5[i4];
              }
              return r4;
            }(t4, n2));
            this.mutationCb({ id: e3, type: r3[0].type, commands: i3 }), this.pendingCanvasMutations.delete(t3);
          }
        }
      }
    }
    class Re2 {
      constructor(t3) {
        a2(this, "trackedLinkElements", /* @__PURE__ */ new WeakSet()), a2(this, "mutationCb"), a2(this, "adoptedStyleSheetCb"), a2(this, "styleMirror", new Lt2()), this.mutationCb = t3.mutationCb, this.adoptedStyleSheetCb = t3.adoptedStyleSheetCb;
      }
      attachLinkElement(t3, e3) {
        "_cssText" in e3.attributes && this.mutationCb({ adds: [], removes: [], texts: [], attributes: [{ id: e3.id, attributes: e3.attributes }] }), this.trackLinkElement(t3);
      }
      trackLinkElement(t3) {
        this.trackedLinkElements.has(t3) || (this.trackedLinkElements.add(t3), this.trackStylesheetInLinkElement(t3));
      }
      adoptStyleSheets(t3, e3) {
        var r3 = this;
        if (0 !== t3.length) {
          var i3 = { id: e3, styleIds: [] }, n3 = [], s3 = function(t4) {
            var e4;
            r3.styleMirror.has(t4) ? e4 = r3.styleMirror.getId(t4) : (e4 = r3.styleMirror.add(t4), n3.push({ styleId: e4, rules: Array.from(t4.rules || CSSRule, (e5, r4) => ({ rule: T2(e5, t4.href), index: r4 })) })), i3.styleIds.push(e4);
          };
          for (var a3 of t3) s3(a3);
          n3.length > 0 && (i3.styles = n3), this.adoptedStyleSheetCb(i3);
        }
      }
      reset() {
        this.styleMirror.reset(), this.trackedLinkElements = /* @__PURE__ */ new WeakSet(), at2.forEach((t3) => t3.abort()), at2.clear();
      }
      trackStylesheetInLinkElement(t3) {
      }
    }
    class Te2 {
      constructor() {
        a2(this, "nodeMap", /* @__PURE__ */ new WeakMap()), a2(this, "active", false);
      }
      inOtherBuffer(t3, e3) {
        var r3 = this.nodeMap.get(t3);
        return r3 && Array.from(r3).some((t4) => t4 !== e3);
      }
      add(t3, e3) {
        this.active || (this.active = true, requestAnimationFrame(() => {
          this.nodeMap = /* @__PURE__ */ new WeakMap(), this.active = false;
        })), this.nodeMap.set(t3, (this.nodeMap.get(t3) || /* @__PURE__ */ new Set()).add(e3));
      }
      destroy() {
      }
    }
    var Oe2 = false;
    try {
      if (2 !== Array.from([1], (t3) => 2 * t3)[0]) {
        var Ae2 = document.createElement("iframe");
        document.body.appendChild(Ae2), Array.from = (null == (i2 = Ae2.contentWindow) ? void 0 : i2.Array.from) || Array.from, document.body.removeChild(Ae2);
      }
    } catch (t3) {
      console.debug("Unable to override Array.from", t3);
    }
    var Ee2 = new O2(), Ne2 = /* @__PURE__ */ new Set([u2.Mutation, u2.MediaInteraction, u2.StyleSheetRule, u2.CanvasMutation, u2.Font, u2.Log, u2.StyleDeclaration, u2.AdoptedStyleSheet]);
    function Le2(t3) {
      void 0 === t3 && (t3 = {});
      var e3 = t3, i3 = e3.emit, n3 = e3.checkoutEveryNms, s3 = e3.checkoutEveryNth, a3 = e3.blockClass, l3 = void 0 === a3 ? "rr-block" : a3, h3 = e3.blockSelector, d3 = void 0 === h3 ? null : h3, c3 = e3.ignoreClass, v3 = void 0 === c3 ? "rr-ignore" : c3, f3 = e3.ignoreSelector, p3 = void 0 === f3 ? null : f3, m3 = e3.maskTextClass, g3 = void 0 === m3 ? "rr-mask" : m3, y3 = e3.maskTextSelector, w3 = void 0 === y3 ? null : y3, b3 = e3.inlineStylesheet, k3 = void 0 === b3 || b3, _3 = e3.maskAllInputs, S3 = e3.maskInputOptions, M3 = e3.slimDOMOptions, C3 = e3.maskInputFn, x3 = e3.maskTextFn, R3 = e3.hooks, T3 = e3.packFn, A3 = e3.sampling, E3 = void 0 === A3 ? {} : A3, N3 = e3.dataURLOptions, L3 = void 0 === N3 ? {} : N3, F3 = e3.canvasResolutionScale, D3 = e3.mousemoveWait, P3 = e3.recordDOM, W3 = void 0 === P3 || P3, B3 = e3.recordCanvas, U3 = void 0 !== B3 && B3, z3 = e3.recordCrossOriginIframes, j3 = void 0 !== z3 && z3, q3 = e3.recordAfter, H3 = void 0 === q3 ? "DOMContentLoaded" === t3.recordAfter ? t3.recordAfter : "load" : q3, G3 = e3.userTriggeredOnInput, V3 = void 0 !== G3 && G3, Z3 = e3.collectFonts, J3 = void 0 !== Z3 && Z3, Q3 = e3.inlineImages, X3 = void 0 !== Q3 && Q3, K3 = e3.plugins, Y3 = e3.keepIframeSrcFn, tt3 = void 0 === Y3 ? () => false : Y3, et3 = e3.ignoreCSSAttributes, rt3 = void 0 === et3 ? /* @__PURE__ */ new Set([]) : et3, it3 = e3.attributeFilter;
      Bt2 = e3.errorHandler;
      var nt3 = r2({ type: "image/webp", quality: 0.4, maxBase64ImageLength: 1048576 }, L3), st3 = !j3 || window.parent === window, at3 = false;
      if (!st3) try {
        window.parent.document && (at3 = false);
      } catch (t4) {
        at3 = true;
      }
      if (st3 && !i3) throw new Error("emit function is required");
      if (!st3 && !at3) return () => {
      };
      void 0 !== D3 && void 0 === E3.mousemove && (E3.mousemove = D3), Ee2.reset();
      var ot3, ut3 = true === _3 ? { color: true, date: true, "datetime-local": true, email: true, month: true, number: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true, textarea: true, select: true, password: true } : void 0 !== S3 ? S3 : { password: true }, lt3 = vt2(void 0 !== M3 && M3);
      !function(t4) {
        void 0 === t4 && (t4 = window), "NodeList" in t4 && !t4.NodeList.prototype.forEach && (t4.NodeList.prototype.forEach = [].forEach), "DOMTokenList" in t4 && !t4.DOMTokenList.prototype.forEach && (t4.DOMTokenList.prototype.forEach = [].forEach);
      }();
      var ht3, dt3, ft3 = 0, mt3 = /* @__PURE__ */ new Map(), yt3 = (t4) => {
        for (var e4 of K3 || []) e4.eventProcessor && (t4 = e4.eventProcessor(t4));
        return T3 && !at3 && (t4 = T3(t4)), t4;
      };
      ke2 = (t4, e4) => {
        var r3, a4 = t4;
        if (a4.timestamp = _t2(), !(null == (r3 = Vt2[0]) ? void 0 : r3.isFrozen()) || a4.type === o2.FullSnapshot || a4.type === o2.IncrementalSnapshot && Ne2.has(a4.data.source) || Vt2.forEach((t5) => t5.unfreeze()), st3) null == i3 || i3(yt3(a4), e4);
        else if (at3) {
          var l4 = { type: "rrweb", event: yt3(a4), origin: window.location.origin, isCheckout: e4 };
          window.parent.postMessage(l4, "*");
        }
        if (a4.type === o2.FullSnapshot) ot3 = a4, ft3 = 0;
        else if (a4.type === o2.IncrementalSnapshot) {
          if (a4.data.source === u2.Mutation && a4.data.isAttachIframe) return;
          ft3++, (s3 && ft3 >= s3 || n3 && a4.timestamp - ot3.timestamp > n3) && _e2(true);
        }
      };
      var wt3 = (t4) => {
        if (t4.removes && t4.removes.length > 0) {
          var e4 = t4.adds.length > 0 ? new Set(t4.adds.map((t5) => t5.node.id)) : null, i4 = /* @__PURE__ */ new Set();
          if (t4.adds.length > 0) for (var n4 of t4.adds) {
            var s4 = Ee2.getNode(n4.node.id);
            s4 && "IFRAME" === s4.nodeName && i4.add(s4);
          }
          t4.removes.forEach((t5) => {
            var r3 = t5.id;
            if (!e4 || !e4.has(r3)) {
              var n5 = xt3.getIframeElementById(r3);
              n5 && i4.has(n5) ? xt3.forgetIframeId(r3) : (null == ht3 || ht3(r3), xt3.removeIframeById(r3));
            }
          }), null == dt3 || dt3(), xt3.cleanupDetachedIframes();
        }
        ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.Mutation }, t4) });
      }, bt3 = (t4) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.Scroll }, t4) }), kt3 = (t4) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.CanvasMutation }, t4) }), Ct3 = new Re2({ mutationCb: wt3, adoptedStyleSheetCb: (t4) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.AdoptedStyleSheet }, t4) }) }), xt3 = new oe2({ mirror: Ee2, mutationCb: wt3, stylesheetManager: Ct3, recordCrossOriginIframes: j3, wrappedEmit: ke2 });
      for (var Rt3 of K3 || []) Rt3.getMirror && Rt3.getMirror({ nodeMirror: Ee2, crossOriginIframeMirror: xt3.crossOriginIframeMirror, crossOriginIframeStyleMirror: xt3.crossOriginIframeStyleMirror });
      var Tt3 = new Te2();
      Se2 = new xe2({ recordCanvas: U3, mutationCb: kt3, win: window, blockClass: l3, blockSelector: d3, mirror: Ee2, sampling: E3.canvas, dataURLOptions: nt3, resolutionScale: F3 });
      var Ot3 = new ue2({ mutationCb: wt3, scrollCb: bt3, bypassOptions: { blockClass: l3, blockSelector: d3, maskTextClass: g3, maskTextSelector: w3, inlineStylesheet: k3, maskInputOptions: ut3, dataURLOptions: nt3, maskTextFn: x3, maskInputFn: C3, recordCanvas: U3, inlineImages: X3, sampling: E3, slimDOMOptions: lt3, iframeManager: xt3, stylesheetManager: Ct3, canvasManager: Se2, keepIframeSrcFn: tt3, processedNodeManager: Tt3, attributeFilter: it3 }, mirror: Ee2 });
      _e2 = function(t4) {
        if (void 0 === t4 && (t4 = false), W3) {
          ke2({ type: o2.Meta, data: { href: window.location.href, width: Mt2(), height: It2() } }, t4), Ct3.reset(), Ot3.init(), Vt2.forEach((t5) => t5.lock());
          var e4 = function(t5, e5) {
            var r3 = e5 || {}, i4 = r3.mirror, n4 = void 0 === i4 ? new O2() : i4, s4 = r3.blockClass, a4 = r3.blockSelector, o3 = r3.maskTextClass, u3 = r3.maskTextSelector, l4 = r3.inlineStylesheet, h4 = r3.inlineImages, d4 = void 0 !== h4 && h4, c4 = r3.recordCanvas, v4 = void 0 !== c4 && c4, f4 = r3.maskAllInputs, p4 = void 0 !== f4 && f4, m4 = r3.slimDOM, g4 = r3.dataURLOptions, y4 = r3.preserveWhiteSpace, w4 = r3.onSerialize, b4 = r3.onIframeLoad, k4 = r3.iframeLoadTimeout, _4 = r3.onIframeListenerRegistered, S4 = r3.onStylesheetLoad, I3 = r3.stylesheetLoadTimeout, M4 = r3.keepIframeSrcFn, C4 = void 0 === M4 ? () => false : M4, x4 = r3.maxDepth;
            return ct2(t5, { doc: t5, mirror: n4, blockClass: void 0 === s4 ? "rr-block" : s4, blockSelector: void 0 === a4 ? null : a4, maskTextClass: void 0 === o3 ? "rr-mask" : o3, maskTextSelector: void 0 === u3 ? null : u3, skipChild: false, inlineStylesheet: void 0 === l4 || l4, maskInputOptions: true === p4 ? { color: true, date: true, "datetime-local": true, email: true, month: true, number: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true, textarea: true, select: true, password: true } : false === p4 ? { password: true } : p4, maskTextFn: r3.maskTextFn, maskInputFn: r3.maskInputFn, slimDOMOptions: vt2(void 0 !== m4 && m4), dataURLOptions: g4, inlineImages: d4, recordCanvas: v4, preserveWhiteSpace: y4, onSerialize: w4, onIframeLoad: b4, iframeLoadTimeout: k4, onIframeListenerRegistered: _4, onStylesheetLoad: S4, stylesheetLoadTimeout: I3, keepIframeSrcFn: C4, newlyAddedElement: false, maxDepth: x4 });
          }(document, { mirror: Ee2, blockClass: l3, blockSelector: d3, maskTextClass: g3, maskTextSelector: w3, inlineStylesheet: k3, maskAllInputs: ut3, maskTextFn: x3, maskInputFn: C3, slimDOM: lt3, dataURLOptions: nt3, recordCanvas: U3, inlineImages: X3, onSerialize(t5) {
            At2(t5, Ee2) && xt3.addIframe(t5), Et2(t5, Ee2) && Ct3.trackLinkElement(t5), Nt2(t5) && Ot3.addShadowRoot(I2.shadowRoot(t5), document);
          }, onIframeLoad(t5, e5) {
            xt3.attachIframe(t5, e5), Ot3.observeAttachShadow(t5);
          }, onIframeListenerRegistered(t5, e5) {
            xt3.registerLoadListenerDisposer(t5, e5);
          }, onStylesheetLoad(t5, e5) {
            Ct3.attachLinkElement(t5, e5);
          }, keepIframeSrcFn: tt3 });
          if (!e4) return console.warn("Failed to snapshot the document");
          ke2({ type: o2.FullSnapshot, data: { node: e4, initialOffset: St2(window) } }, t4), Vt2.forEach((t5) => t5.unlock()), j3 && xt3.reattachIframes(), document.adoptedStyleSheets && document.adoptedStyleSheets.length > 0 && Ct3.adoptStyleSheets(document.adoptedStyleSheets, Ee2.getId(document));
        }
      };
      try {
        var Lt3 = [];
        ht3 = (t4) => {
          var e4 = mt3.get(t4);
          e4 && (e4.forEach((t5) => {
            gt2(t5);
            var e5 = Lt3.indexOf(t5);
            -1 !== e5 && Lt3.splice(e5, 1);
          }), mt3.delete(t4));
        }, dt3 = () => {
          for (var t4 of mt3) {
            var e4 = t4[0], r3 = Ee2.getNode(e4);
            if (r3) try {
              r3.contentDocument && r3.contentDocument.defaultView || null == ht3 || ht3(e4);
            } catch (t5) {
              null == ht3 || ht3(e4);
            }
            else null == ht3 || ht3(e4);
          }
        };
        var Ft3 = (t4) => {
          var e4;
          return Gt2(ie2)({ mutationCb: wt3, mousemoveCb: (t5, e5) => ke2({ type: o2.IncrementalSnapshot, data: { source: e5, positions: t5 } }), mouseInteractionCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.MouseInteraction }, t5) }), scrollCb: bt3, viewportResizeCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.ViewportResize }, t5) }), inputCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.Input }, t5) }), mediaInteractionCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.MediaInteraction }, t5) }), styleSheetRuleCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.StyleSheetRule }, t5) }), styleDeclarationCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.StyleDeclaration }, t5) }), canvasMutationCb: kt3, fontCb: (t5) => ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.Font }, t5) }), selectionCb(t5) {
            ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.Selection }, t5) });
          }, customElementCb(t5) {
            ke2({ type: o2.IncrementalSnapshot, data: r2({ source: u2.CustomElement }, t5) });
          }, blockClass: l3, ignoreClass: v3, ignoreSelector: p3, maskTextClass: g3, maskTextSelector: w3, maskInputOptions: ut3, inlineStylesheet: k3, sampling: E3, recordDOM: W3, recordCanvas: U3, inlineImages: X3, userTriggeredOnInput: V3, collectFonts: J3, doc: t4, maskInputFn: C3, maskTextFn: x3, keepIframeSrcFn: tt3, blockSelector: d3, slimDOMOptions: lt3, dataURLOptions: nt3, mirror: Ee2, iframeManager: xt3, stylesheetManager: Ct3, shadowDomManager: Ot3, processedNodeManager: Tt3, canvasManager: Se2, ignoreCSSAttributes: rt3, attributeFilter: it3, plugins: (null == (e4 = null == K3 ? void 0 : K3.filter((t5) => t5.observer)) ? void 0 : e4.map((t5) => ({ observer: t5.observer, options: t5.options, callback: (e5) => ke2({ type: o2.Plugin, data: { plugin: t5.name, payload: e5 } }) }))) || [] }, R3);
        };
        xt3.addLoadListener((t4) => {
          try {
            var e4 = Ee2.getId(t4), r3 = Ft3(t4.contentDocument);
            if (Lt3.push(r3), -1 !== e4) {
              var i4 = mt3.get(e4);
              i4 || mt3.set(e4, i4 = /* @__PURE__ */ new Set()), i4.add(r3);
            }
          } catch (t5) {
            console.warn(t5);
          }
        }), xt3.addPageHideListener((t4) => {
          var e4 = Ee2.getId(t4);
          null == ht3 || ht3(e4), Xt2(t4);
        });
        var Dt3 = -1, Pt3 = (t4) => ke2({ type: o2.Custom, data: { tag: "rrweb/fullscreen", payload: t4 } }), Wt3 = () => {
          var t4, e4, r3, i4, n4 = document, s4 = null !== (t4 = null !== (e4 = null !== (r3 = null !== (i4 = n4.fullscreenElement) && void 0 !== i4 ? i4 : n4.webkitFullscreenElement) && void 0 !== r3 ? r3 : n4.mozFullScreenElement) && void 0 !== e4 ? e4 : n4.msFullscreenElement) && void 0 !== t4 ? t4 : null, a4 = s4 ? Ee2.getId(s4) : -1;
          a4 !== Dt3 && (-1 !== Dt3 && Pt3({ id: Dt3, enter: false }), Dt3 = a4, -1 !== a4 && Pt3({ id: a4, enter: true }));
        }, $t3 = () => {
          _e2(), Lt3.push(Ft3(document)), Lt3.push(pt2("fullscreenchange", Wt3)), Lt3.push(pt2("webkitfullscreenchange", Wt3)), Lt3.push(pt2("mozfullscreenchange", Wt3)), Lt3.push(pt2("MSFullscreenChange", Wt3)), Oe2 = true;
        };
        return ["interactive", "complete"].includes(document.readyState) ? $t3() : (Lt3.push(pt2("DOMContentLoaded", () => {
          ke2({ type: o2.DomContentLoaded, data: {} }), "DOMContentLoaded" === H3 && $t3();
        })), Lt3.push(pt2("load", () => {
          ke2({ type: o2.Load, data: {} }), "load" === H3 && $t3();
        }, window))), () => {
          Lt3.forEach((t4) => gt2(t4)), Tt3.destroy(), xt3.removeLoadListener(), xt3.destroy(), mt3.clear(), Ot3.reset(), Ee2.reset(), Oe2 = false, Bt2 = void 0;
        };
      } catch (t4) {
        console.warn(t4);
      }
    }
    Le2.addCustomEvent = (t3, e3) => {
      if (!Oe2) throw new Error("please add custom event after start recording");
      ke2({ type: o2.Custom, data: { tag: t3, payload: e3 } });
    }, Le2.freezePage = () => {
      Vt2.forEach((t3) => t3.freeze());
    }, Le2.takeFullSnapshot = (t3) => {
      if (!Oe2) throw new Error("please take full snapshot after start recording");
      _e2(t3);
    }, Le2.mirror = Ee2;
    var Fe2 = Object.defineProperty, De2 = (t3, e3, r3) => ((t4, e4, r4) => e4 in t4 ? Fe2(t4, e4, { enumerable: true, configurable: true, writable: true, value: r4 }) : t4[e4] = r4)(t3, "symbol" != typeof e3 ? e3 + "" : e3, r3);
    class Pe2 {
      constructor(t3) {
        De2(this, "fileName"), De2(this, "functionName"), De2(this, "lineNumber"), De2(this, "columnNumber"), this.fileName = t3.fileName || "", this.functionName = t3.functionName || "", this.lineNumber = t3.lineNumber, this.columnNumber = t3.columnNumber;
      }
      toString() {
        var t3 = this.lineNumber || "", e3 = this.columnNumber || "";
        return this.functionName ? this.functionName + " (" + this.fileName + ":" + t3 + ":" + e3 + ")" : this.fileName + ":" + t3 + ":" + e3;
      }
    }
    var We2 = /(^|@)\S+:\d+/, Be2 = /^\s*at .*(\S+:\d+|\(native\))/m, $e2 = /^(eval@)?(\[native code])?$/, Ue2 = { parse(t3) {
      return t3 ? void 0 !== t3.stacktrace || void 0 !== t3["opera#sourceloc"] ? this.parseOpera(t3) : t3.stack && t3.stack.match(Be2) ? this.parseV8OrIE(t3) : t3.stack ? this.parseFFOrSafari(t3) : [] : [];
    }, extractLocation(t3) {
      if (-1 === t3.indexOf(":")) return [t3];
      var e3 = /(.+?)(?::(\d+))?(?::(\d+))?$/.exec(t3.replace(/[()]/g, ""));
      if (!e3) throw new Error("Cannot parse given url: " + t3);
      return [e3[1], e3[2] || void 0, e3[3] || void 0];
    }, parseV8OrIE(t3) {
      return t3.stack.split("\n").filter(function(t4) {
        return !!t4.match(Be2);
      }, this).map(function(t4) {
        t4.indexOf("(eval ") > -1 && (t4 = t4.replace(/eval code/g, "eval").replace(/(\(eval at [^()]*)|(\),.*$)/g, ""));
        var e3 = t4.replace(/^\s+/, "").replace(/\(eval code/g, "("), r3 = e3.match(/ (\((.+):(\d+):(\d+)\)$)/), i3 = (e3 = r3 ? e3.replace(r3[0], "") : e3).split(/\s+/).slice(1), n3 = this.extractLocation(r3 ? r3[1] : i3.pop()), s3 = i3.join(" ") || void 0, a3 = ["eval", "<anonymous>"].indexOf(n3[0]) > -1 ? void 0 : n3[0];
        return new Pe2({ functionName: s3, fileName: a3, lineNumber: n3[1], columnNumber: n3[2] });
      }, this);
    }, parseFFOrSafari(t3) {
      return t3.stack.split("\n").filter(function(t4) {
        return !t4.match($e2);
      }, this).map(function(t4) {
        if (t4.indexOf(" > eval") > -1 && (t4 = t4.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g, ":$1")), -1 === t4.indexOf("@") && -1 === t4.indexOf(":")) return new Pe2({ functionName: t4 });
        var e3 = /((.*".+"[^@]*)?[^@]*)(?:@)/, r3 = t4.match(e3), i3 = r3 && r3[1] ? r3[1] : void 0, n3 = this.extractLocation(t4.replace(e3, ""));
        return new Pe2({ functionName: i3, fileName: n3[0], lineNumber: n3[1], columnNumber: n3[2] });
      }, this);
    }, parseOpera(t3) {
      return !t3.stacktrace || t3.message.indexOf("\n") > -1 && t3.message.split("\n").length > t3.stacktrace.split("\n").length ? this.parseOpera9(t3) : t3.stack ? this.parseOpera11(t3) : this.parseOpera10(t3);
    }, parseOpera9(t3) {
      for (var e3 = /Line (\d+).*script (?:in )?(\S+)/i, r3 = t3.message.split("\n"), i3 = [], n3 = 2, s3 = r3.length; s3 > n3; n3 += 2) {
        var a3 = e3.exec(r3[n3]);
        a3 && i3.push(new Pe2({ fileName: a3[2], lineNumber: parseFloat(a3[1]) }));
      }
      return i3;
    }, parseOpera10(t3) {
      for (var e3 = /Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i, r3 = t3.stacktrace.split("\n"), i3 = [], n3 = 0, s3 = r3.length; s3 > n3; n3 += 2) {
        var a3 = e3.exec(r3[n3]);
        a3 && i3.push(new Pe2({ functionName: a3[3] || void 0, fileName: a3[2], lineNumber: parseFloat(a3[1]) }));
      }
      return i3;
    }, parseOpera11(t3) {
      return t3.stack.split("\n").filter(function(t4) {
        return !!t4.match(We2) && !t4.match(/^Error created at/);
      }, this).map(function(t4) {
        var e3 = t4.split("@"), r3 = this.extractLocation(e3.pop()), i3 = (e3.shift() || "").replace(/<anonymous function(: (\w+))?>/, "$2").replace(/\([^)]*\)/g, "") || void 0;
        return new Pe2({ functionName: i3, fileName: r3[0], lineNumber: r3[1], columnNumber: r3[2] });
      }, this);
    } };
    function ze2(t3) {
      if (!t3 || !t3.outerHTML) return "";
      for (var e3 = ""; t3.parentElement; ) {
        var r3 = t3.localName;
        if (!r3) break;
        r3 = r3.toLowerCase();
        var i3 = t3.parentElement, n3 = [];
        if (i3.children && i3.children.length > 0) for (var s3 = 0; i3.children.length > s3; s3++) {
          var a3 = i3.children[s3];
          a3.localName && a3.localName.toLowerCase && a3.localName.toLowerCase() === r3 && n3.push(a3);
        }
        n3.length > 1 && (r3 += ":eq(" + n3.indexOf(t3) + ")"), e3 = r3 + (e3 ? ">" + e3 : ""), t3 = i3;
      }
      return e3;
    }
    function je2(t3) {
      return Array.isArray(t3);
    }
    function qe2(t3) {
      return "object" == typeof t3 && null !== t3 && !je2(t3);
    }
    function He2(t3, e3) {
      if (0 === e3) return true;
      var r3 = Object.keys(t3);
      for (var i3 of r3) if (qe2(t3[i3]) && He2(t3[i3], e3 - 1)) return true;
      return false;
    }
    function Ge2(t3, e3) {
      var r3 = { numOfKeysLimit: 50, depthOfLimit: 4 };
      Object.assign(r3, e3);
      var i3 = [], n3 = [];
      return JSON.stringify(t3, function(t4, e4) {
        if (i3.length > 0) {
          var s3 = i3.indexOf(this);
          ~s3 ? i3.splice(s3 + 1) : i3.push(this), ~s3 ? n3.splice(s3, 1 / 0, t4) : n3.push(t4), ~i3.indexOf(e4) && (e4 = i3[0] === e4 ? "[Circular ~]" : "[Circular ~." + n3.slice(0, i3.indexOf(e4)).join(".") + "]");
        } else i3.push(e4);
        if (null === e4) return e4;
        if (void 0 === e4) return "undefined";
        if (qe2(a3 = e4) && Object.keys(a3).length > r3.numOfKeysLimit || "function" == typeof a3 || qe2(a3) && He2(a3, r3.depthOfLimit)) return function(t5) {
          var e5 = t5.toString();
          return r3.stringLengthLimit && e5.length > r3.stringLengthLimit && (e5 = e5.slice(0, r3.stringLengthLimit) + "..."), e5;
        }(e4);
        var a3;
        if ("bigint" == typeof e4) return e4.toString() + "n";
        if (e4 instanceof Event) {
          var o3 = {};
          for (var u3 in e4) {
            var l3 = e4[u3];
            o3[u3] = je2(l3) ? ze2(l3.length ? l3[0] : null) : l3;
          }
          return o3;
        }
        return e4 instanceof Node ? e4 instanceof HTMLElement ? e4 ? e4.outerHTML : "" : e4.nodeName : e4 instanceof Error ? e4.stack ? e4.stack + "\nEnd of stack for Error object" : e4.name + ": " + e4.message : e4;
      });
    }
    var Ve2 = { level: ["assert", "clear", "count", "countReset", "debug", "dir", "dirxml", "error", "group", "groupCollapsed", "groupEnd", "info", "log", "table", "time", "timeEnd", "timeLog", "trace", "warn"], lengthThreshold: 1e3, logger: "console" };
    function Ze2(t3, e3, r3) {
      var i3, n3 = r3 ? Object.assign({}, Ve2, r3) : Ve2, s3 = n3.logger;
      if (!s3) return () => {
      };
      i3 = "string" == typeof s3 ? e3[s3] : s3;
      var a3 = 0, o3 = false, u3 = [];
      if (n3.level.includes("error")) {
        var l3 = (e4) => {
          var r4 = e4.message, i4 = Ue2.parse(e4.error).map((t4) => t4.toString()), s4 = [Ge2(r4, n3.stringifyOptions)];
          t3({ level: "error", trace: i4, payload: s4 });
        };
        e3.addEventListener("error", l3), u3.push(() => {
          e3.removeEventListener("error", l3);
        });
        var h3 = (e4) => {
          var r4, i4;
          e4.reason instanceof Error ? i4 = [Ge2("Uncaught (in promise) " + (r4 = e4.reason).name + ": " + r4.message, n3.stringifyOptions)] : (r4 = new Error(), i4 = [Ge2("Uncaught (in promise)", n3.stringifyOptions), Ge2(e4.reason, n3.stringifyOptions)]);
          var s4 = Ue2.parse(r4).map((t4) => t4.toString());
          t3({ level: "error", trace: s4, payload: i4 });
        };
        e3.addEventListener("unhandledrejection", h3), u3.push(() => {
          e3.removeEventListener("unhandledrejection", h3);
        });
      }
      for (var d3 of n3.level) u3.push(c3(i3, d3));
      return () => {
        u3.forEach((t4) => t4());
      };
      function c3(e4, r4) {
        var i4 = this;
        return e4[r4] ? function(e5, s4, u4) {
          try {
            if (!(s4 in e5)) return () => {
            };
            var l4 = e5[s4], h4 = { next: l4 }, d4 = /* @__PURE__ */ ((e6) => function() {
              for (var s5 = arguments.length, u5 = new Array(s5), l5 = 0; s5 > l5; l5++) u5[l5] = arguments[l5];
              if (e6.apply(i4, u5), !("assert" === r4 && u5[0] || o3)) {
                o3 = true;
                try {
                  var h5 = Ue2.parse(new Error()).map((t4) => t4.toString()).splice(1), d5 = ("assert" === r4 ? u5.slice(1) : u5).map((t4) => Ge2(t4, n3.stringifyOptions));
                  a3++, n3.lengthThreshold > a3 ? t3({ level: r4, trace: h5, payload: d5 }) : a3 === n3.lengthThreshold && t3({ level: "warn", trace: [], payload: [Ge2("The number of log records reached the threshold.")] });
                } catch (t4) {
                  e6("rrweb logger error:", t4, ...u5);
                } finally {
                  o3 = false;
                }
              }
            })(function() {
              for (var t4 = arguments.length, e6 = new Array(t4), r5 = 0; t4 > r5; r5++) e6[r5] = arguments[r5];
              return h4.next.apply(this, e6);
            });
            return "function" == typeof d4 && (d4.prototype = d4.prototype || {}, Object.defineProperties(d4, { __rrweb_original__: { enumerable: false, value: l4 }, __rrweb_layer__: { enumerable: false, value: h4 } })), e5[s4] = d4, () => {
              if (e5[s4] !== d4) for (var t4 = e5[s4]; "function" == typeof t4 && t4.__rrweb_layer__; ) {
                var r5 = t4.__rrweb_layer__;
                if (r5.next === d4) return void (r5.next = h4.next);
                t4 = r5.next;
              }
              else e5[s4] = h4.next;
            };
          } catch (t4) {
            return () => {
            };
          }
        }(e4, r4) : () => {
        };
      }
    }
    var Je2 = "undefined" != typeof window ? window : void 0, Qe2 = "undefined" != typeof globalThis ? globalThis : Je2, Xe2 = null == Qe2 ? void 0 : Qe2.document, Ke2 = null == Qe2 ? void 0 : Qe2.location;
    null != Qe2 && Qe2.XMLHttpRequest && new Qe2.XMLHttpRequest();
    var Ye2 = "undefined" != typeof globalThis ? globalThis : Je2;
    Ye2 && "undefined" == typeof self && (Ye2.self = Ye2), Ye2 && "undefined" == typeof File && (Ye2.File = function() {
    });
    var tr2, er2 = null != Je2 ? Je2 : {}, rr2 = "NativeGzipValidationError", ir2 = (t3) => {
      var e3 = new Error("Native gzip produced invalid output: " + t3);
      throw e3.name = rr2, e3;
    }, nr2 = function() {
      var t3 = e2(function* (t4, e3) {
        18 > t4.size && ir2("too-short");
        var r3, i3 = new Uint8Array(yield t4.slice(0, 10).arrayBuffer());
        (2 > (r3 = i3).length || 31 !== r3[0] || 139 !== r3[1] || 8 !== i3[2]) && ir2("invalid-header");
        var n3 = new DataView(yield t4.slice(t4.size - 8).arrayBuffer());
        n3.getUint32(0, true) !== ((t5) => {
          for (var e4 = (() => {
            if (tr2) return tr2;
            tr2 = [];
            for (var t6 = 0; 256 > t6; t6++) {
              for (var e5 = t6, r5 = 0; 8 > r5; r5++) e5 = 1 & e5 ? 3988292384 ^ e5 >>> 1 : e5 >>> 1;
              tr2[t6] = e5 >>> 0;
            }
            return tr2;
          })(), r4 = 4294967295, i4 = 0; t5.length > i4; i4++) r4 = e4[255 & (r4 ^ t5[i4])] ^ r4 >>> 8;
          return (4294967295 ^ r4) >>> 0;
        })(e3) && ir2("invalid-crc");
        var s3 = e3.length >>> 0;
        n3.getUint32(4, true) !== s3 && ir2("invalid-size");
      });
      return function(e3, r3) {
        return t3.apply(this, arguments);
      };
    }();
    function sr2() {
      return sr2 = e2(function* (t3, r3, i3) {
        void 0 === r3 && (r3 = true);
        try {
          var n3 = new TextEncoder().encode(t3), s3 = new globalThis.CompressionStream("gzip"), a3 = s3.writable.getWriter(), o3 = a3.write(n3).then(() => a3.close()).catch(function() {
            var t4 = e2(function* (t5) {
              try {
                yield a3.abort(t5);
              } catch (t6) {
              }
              throw t5;
            });
            return function(e3) {
              return t4.apply(this, arguments);
            };
          }()), u3 = new Response(s3.readable).blob(), l3 = (yield Promise.all([u3, o3]))[0];
          return yield nr2(l3, n3), l3;
        } catch (t4) {
          if (null != i3 && i3.rethrow) throw t4;
          return r3 && console.error("Failed to gzip compress data", t4), null;
        }
      }), sr2.apply(this, arguments);
    }
    var ar2 = Object.prototype, or2 = ar2.hasOwnProperty, ur2 = ar2.toString, lr2 = Array.isArray || function(t3) {
      return "[object Array]" === ur2.call(t3);
    }, hr2 = (t3) => "function" == typeof t3, dr2 = (t3) => t3 === Object(t3) && !lr2(t3), cr2 = (t3) => void 0 === t3, vr2 = (t3) => "[object String]" == ur2.call(t3), fr2 = (t3) => null === t3, pr2 = (t3) => cr2(t3) || fr2(t3), mr2 = (t3) => "[object Number]" == ur2.call(t3) && t3 == t3, gr2 = (t3) => "[object Boolean]" === ur2.call(t3), yr2 = (t3) => t3 instanceof FormData;
    function wr2(t3, e3, r3, i3, n3) {
      return e3 > r3 && (i3.warn("min cannot be greater than max."), e3 = r3), mr2(t3) ? t3 > r3 ? (i3.warn(" cannot be  greater than max: " + r3 + ". Using max value instead."), r3) : e3 > t3 ? (i3.warn(" cannot be less than min: " + e3 + ". Using min value instead."), e3) : t3 : (i3.warn(" must be a number. using max or fallback. max: " + r3 + ", fallback: " + n3), wr2(n3 || r3, e3, r3, i3));
    }
    class br2 {
      constructor(t3) {
        this.tt = {}, this.et = t3.et, this.rt = wr2(t3.bucketSize, 0, 100, t3.it), this.nt = wr2(t3.refillRate, 0, this.rt, t3.it), this.st = wr2(t3.refillInterval, 0, 864e5, t3.it);
      }
      ot(t3, e3) {
        var r3 = Math.floor((e3 - t3.lastAccess) / this.st);
        r3 > 0 && (t3.tokens = Math.min(t3.tokens + r3 * this.nt, this.rt), t3.lastAccess = t3.lastAccess + r3 * this.st);
      }
      consumeRateLimit(t3) {
        var e3, r3 = Date.now(), i3 = String(t3), n3 = this.tt[i3];
        return n3 ? this.ot(n3, r3) : this.tt[i3] = n3 = { tokens: this.rt, lastAccess: r3 }, 0 === n3.tokens || (n3.tokens--, 0 === n3.tokens && (null == (e3 = this.et) || e3.call(this, t3)), 0 === n3.tokens);
      }
      stop() {
        this.tt = {};
      }
    }
    function kr2(t3) {
      return t3 ? t3.split("#")[0] : t3;
    }
    var _r2 = (t3) => "undefined" != typeof Document && t3 instanceof Document, Sr2 = "0.2.0", Ir2 = { DEBUG: false, LIB_VERSION: Sr2, LIB_NAME: "browser-common", JS_SDK_VERSION: Sr2 }, Mr2 = function(t3, e3) {
      var r3 = (void 0 === e3 ? {} : e3).debugEnabled, i3 = { k(e4) {
        if (Je2 && (Ir2.DEBUG || Je2.POSTHOG_DEBUG || r3) && !cr2(Je2.console) && Je2.console) {
          for (var i4 = ("__rrweb_original__" in Je2.console[e4]) ? Je2.console[e4].__rrweb_original__ : Je2.console[e4], n3 = arguments.length, s3 = new Array(n3 > 1 ? n3 - 1 : 0), a3 = 1; n3 > a3; a3++) s3[a3 - 1] = arguments[a3];
          i4(t3, ...s3);
        }
      }, debug() {
        for (var t4 = arguments.length, e4 = new Array(t4), r4 = 0; t4 > r4; r4++) e4[r4] = arguments[r4];
        i3.k("debug", ...e4);
      }, info() {
        for (var t4 = arguments.length, e4 = new Array(t4), r4 = 0; t4 > r4; r4++) e4[r4] = arguments[r4];
        i3.k("log", ...e4);
      }, warn() {
        for (var t4 = arguments.length, e4 = new Array(t4), r4 = 0; t4 > r4; r4++) e4[r4] = arguments[r4];
        i3.k("warn", ...e4);
      }, error() {
        for (var t4 = arguments.length, e4 = new Array(t4), r4 = 0; t4 > r4; r4++) e4[r4] = arguments[r4];
        i3.k("error", ...e4);
      }, critical() {
        for (var e4 = arguments.length, r4 = new Array(e4), i4 = 0; e4 > i4; i4++) r4[i4] = arguments[i4];
        console.error(t3, ...r4);
      }, uninitializedWarning(t4) {
        i3.error("You must initialize PostHog before calling " + t4);
      }, createLogger: (e4, r4) => Mr2(t3 + " " + e4, r4) };
      return i3;
    }, Cr2 = Mr2("[PostHog.js]"), xr2 = Cr2.createLogger;
    function Rr2(t3, e3) {
      if (!pr2(t3)) if (lr2(t3)) t3.forEach(e3);
      else if (yr2(t3)) t3.forEach((t4, r4) => e3(t4, r4));
      else for (var r3 in t3) or2.call(t3, r3) && e3(t3[r3], r3);
    }
    function Tr2(t3, e3, r3, i3) {
      var n3 = {}, s3 = n3.capture, a3 = n3.passive;
      null == t3 || t3.addEventListener(e3, r3, { capture: void 0 !== s3 && s3, passive: void 0 === a3 || a3 });
    }
    var Or2 = ["localhost", "127.0.0.1"], Ar2 = (t3) => {
      var e3 = null == Xe2 ? void 0 : Xe2.createElement("a");
      return cr2(e3) ? null : (e3.href = t3, e3);
    }, Er2 = function(t3, e3) {
      var r3, i3;
      void 0 === e3 && (e3 = "&");
      var n3 = [];
      return Rr2(t3, function(t4, e4) {
        cr2(t4) || cr2(e4) || "undefined" === e4 || (r3 = encodeURIComponent(((t5) => t5 instanceof File)(t4) ? t4.name : t4.toString()), i3 = encodeURIComponent(e4), n3[n3.length] = i3 + "=" + r3);
      }), n3.join(e3);
    }, Nr2 = () => {
    };
    function Lr2(t3, e3, r3) {
      try {
        if (!(e3 in t3)) return Nr2;
        var i3 = { next: t3[e3] }, n3 = r3(function() {
          for (var t4 = arguments.length, e4 = new Array(t4), r4 = 0; t4 > r4; r4++) e4[r4] = arguments[r4];
          return i3.next.apply(this, e4);
        });
        return hr2(n3) && (n3.prototype = n3.prototype || {}, Object.defineProperties(n3, { __posthog_wrapped__: { enumerable: false, value: true }, __posthog_layer__: { enumerable: false, value: i3 } })), t3[e3] = n3, () => {
          if (t3[e3] !== n3) for (var r4 = t3[e3]; hr2(r4) && r4.__posthog_layer__; ) {
            var s3 = r4.__posthog_layer__;
            if (s3.next === n3) return void (s3.next = i3.next);
            r4 = s3.next;
          }
          else t3[e3] = i3.next;
        };
      } catch (t4) {
        return Nr2;
      }
    }
    function Fr2(t3, e3) {
      var r3, i3 = function(t4) {
        try {
          return "string" == typeof t4 ? new URL(t4).hostname : "url" in t4 ? new URL(t4.url).hostname : t4.hostname;
        } catch (t5) {
          return null;
        }
      }(t3), n3 = { hostname: i3, isHostDenied: false };
      if (null == (r3 = e3.payloadHostDenyList) || !r3.length || null == i3 || !i3.trim().length) return n3;
      for (var s3 of e3.payloadHostDenyList) if (i3.endsWith(s3)) return { hostname: i3, isHostDenied: true };
      return n3;
    }
    function Dr2(t3) {
      var e3, r3 = null == Je2 || null == (e3 = Je2.location) ? void 0 : e3.href;
      return cr2(r3) ? void 0 : function(t4, e4) {
        var r4, i3 = null == t4 || null == (r4 = t4.config) ? void 0 : r4.get_current_url;
        if (!hr2(i3)) return e4;
        try {
          var n3 = i3(e4);
          return vr2(n3) && n3 ? n3 : e4;
        } catch (t5) {
          return Cr2.error("Error in get_current_url, falling back to window.location.href", t5), e4;
        }
      }(t3, r3);
    }
    var Pr2 = new RegExp("(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})"), Wr2 = new RegExp("(\\d{3}-?\\d{2}-?\\d{4})"), Br2 = "[SessionRecording]", $r2 = "redacted", Ur2 = 1e6;
    function zr2(t3) {
      var e3;
      return Math.min(Ur2, null !== (e3 = t3.payloadSizeLimitBytes) && void 0 !== e3 ? e3 : Ur2);
    }
    var jr2 = { initiatorTypes: ["audio", "beacon", "body", "css", "early-hint", "embed", "fetch", "frame", "iframe", "icon", "image", "img", "input", "link", "navigation", "object", "ping", "script", "track", "video", "xmlhttprequest"], maskRequestFn: (t3) => t3, recordHeaders: false, recordBody: false, recordInitialRequests: false, recordPerformance: false, performanceEntryTypeToObserve: ["first-input", "navigation", "paint", "resource"], payloadSizeLimitBytes: Ur2, payloadHostDenyList: [".lr-ingest.io", ".ingest.sentry.io", ".clarity.ms", "google-analytics.com", "analytics.google.com", "nr-data.net", "datadoghq.com", "datadoghq.eu", "ddog-gov.com", "segment.io", "rudderstack.com", "amplitude.com", "mixpanel.com", "hotjar.com", "hotjar.io", "fullstory.com"], streamNetworkBody: false }, qr2 = ["authorization", "x-forwarded-for", "authorization", "cookie", "set-cookie", "x-api-key", "x-real-ip", "remote-addr", "forwarded", "proxy-authorization", "x-csrf-token", "x-csrftoken", "x-xsrf-token"], Hr2 = ["password", "secret", "passwd", "api_key", "apikey", "auth", "credentials", "mysql_pwd", "privatekey", "private_key", "token"], Gr2 = ["auth", "token", "secret", "session", "api-key", "apikey", "api_key", "credential", "password", "passwd", "cookie", "csrf", "xsrf"], Vr2 = (t3) => {
      pr2(t3) || Rr2(Object.keys(t3), (e3) => {
        ((t4) => {
          var e4 = t4.toLowerCase();
          return qr2.includes(e4) || Gr2.some((t5) => e4.includes(t5));
        })(e3) && (t3[e3] = $r2);
      });
    }, Zr2 = ["/s/", "/e/", "/i/"];
    function Jr2(t3, e3, r3, i3) {
      if (pr2(t3)) return t3;
      var n3 = (null == e3 ? void 0 : e3["content-length"]) || function(t4) {
        return new Blob([t4]).size;
      }(t3);
      return vr2(n3) && (n3 = parseInt(n3)), n3 > r3 ? Br2 + " " + i3 + " body too large to record (" + n3 + " bytes)" : t3;
    }
    function Qr2(t3, e3) {
      if (pr2(t3)) return t3;
      var r3 = t3;
      return function(t4, e4) {
        if (pr2(t4)) return false;
        if (vr2(t4)) {
          if (t4 = t4.trim(), Pr2.test((t4 || "").replace(/[- ]/g, ""))) return false;
          if (Wr2.test(t4)) return false;
        }
        return true;
      }(r3) || (r3 = Br2 + " " + e3 + " body " + $r2), Rr2(Hr2, (t4) => {
        var i3, n3;
        null != (i3 = r3) && i3.length && -1 !== (null == (n3 = r3) ? void 0 : n3.indexOf(t4)) && (r3 = Br2 + " " + e3 + " body " + $r2 + " as might contain: " + t4);
      }), r3;
    }
    var Xr2 = xr2("[Recorder]"), Kr2 = (t3) => "navigation" === t3.entryType, Yr2 = (t3) => "resource" === t3.entryType;
    function ti2(t3, e3) {
      return !!e3 && (gr2(e3) || e3[t3]);
    }
    function ei2(t3) {
      if ("undefined" == typeof Request) return false;
      if (t3 instanceof Request) return true;
      try {
        return "[object Request]" === {}.toString.call(t3);
      } catch (t4) {
        return false;
      }
    }
    var ri2 = ["image/", "video/", "audio/", "font/", "application/octet-stream", "application/pdf", "application/zip", "application/wasm"];
    function ii2(t3) {
      var e3 = t3.type, r3 = t3.recordBody, i3 = t3.headers;
      function n3(t4) {
        var e4 = Object.keys(i3).find((t5) => "content-type" === t5.toLowerCase()), r4 = e4 && i3[e4];
        return t4.some((t5) => null == r4 ? void 0 : r4.toLowerCase().includes(t5));
      }
      if (!r3) return false;
      if (function t4(e4) {
        try {
          return "string" == typeof e4 ? e4.startsWith("blob:") : e4 instanceof URL ? "blob:" === e4.protocol : !!ei2(e4) && t4(e4.url);
        } catch (t5) {
          return false;
        }
      }(t3.url)) return false;
      if (n3(ri2)) return false;
      if (gr2(r3)) return true;
      if (lr2(r3)) return n3(r3);
      var s3 = r3[e3];
      return gr2(s3) ? s3 : n3(s3);
    }
    function ni2(t3, e3, r3, i3, n3, s3) {
      return si2.apply(this, arguments);
    }
    function si2() {
      return si2 = e2(function* (t3, e3, r3, i3, n3, s3) {
        if (void 0 === s3 && (s3 = 0), s3 > 10) return Xr2.warn("Failed to get performance entry for request", { url: r3, initiatorType: e3 }), null;
        var a3 = function(t4, r4) {
          for (var s4 = t4.length - 1; s4 >= 0; s4 -= 1) if (Yr2(a4 = t4[s4]) && a4.initiatorType === e3 && (cr2(i3) || a4.startTime >= i3) && (cr2(n3) || n3 >= a4.startTime)) return t4[s4];
          var a4;
        }(t3.performance.getEntriesByName(r3));
        return a3 || (yield new Promise((t4) => setTimeout(t4, 50 * s3)), ni2(t3, e3, r3, i3, n3, s3 + 1));
      }), si2.apply(this, arguments);
    }
    function ai2(t3) {
      var e3 = t3.body, r3 = t3.options, i3 = t3.url;
      if (pr2(e3)) return null;
      var n3 = Fr2(i3, r3);
      if (n3.isHostDenied) return n3.hostname + " is in deny list";
      if (vr2(e3)) return e3;
      if (_r2(e3)) return e3.textContent;
      if (yr2(e3)) return Er2(e3);
      if (dr2(e3)) try {
        return JSON.stringify(e3);
      } catch (t4) {
        return "[SessionReplay] Failed to stringify response object";
      }
      return "[SessionReplay] Cannot read body of type " + toString.call(e3);
    }
    var oi2 = (t3) => !fr2(t3) && ("navigation" === t3.entryType || "resource" === t3.entryType);
    function ui2(t3) {
      var e3 = t3.entry, i3 = t3.method, n3 = t3.status, s3 = t3.networkRequest, a3 = t3.isInitial, o3 = t3.start, u3 = t3.end, l3 = t3.url, h3 = t3.initiatorType;
      o3 = e3 ? e3.startTime : o3, u3 = e3 ? e3.responseEnd : u3;
      var d3 = Math.floor(Date.now() - performance.now()), c3 = Math.floor(d3 + (o3 || 0)), v3 = [r2({}, e3 ? e3.toJSON() : { name: l3 }, { startTime: cr2(o3) ? void 0 : Math.round(o3), endTime: cr2(u3) ? void 0 : Math.round(u3), timeOrigin: d3, timestamp: c3, method: i3, initiatorType: h3 || (e3 ? e3.initiatorType : void 0), status: n3, requestHeaders: s3.requestHeaders, requestBody: s3.requestBody, responseHeaders: s3.responseHeaders, responseBody: s3.responseBody, isInitial: a3 })];
      if (oi2(e3)) for (var f3 of e3.serverTiming || []) v3.push({ timeOrigin: d3, timestamp: c3, startTime: Math.round(e3.startTime), name: f3.name, duration: f3.duration, entryType: "serverTiming" });
      return v3;
    }
    var li2 = ["video/", "audio/"];
    function hi2(t3) {
      return dr2(t3) && hr2(t3.getReader) && hr2(t3.tee);
    }
    var di2 = 500, ci2 = "[SessionReplay] Timeout while trying to read body", vi2 = "[SessionReplay] Failed to read body";
    function fi2(t3) {
      return vi2 + ": " + t3;
    }
    function pi2(t3) {
      return "[SessionReplay] Body too large to record (> " + t3 + " bytes)";
    }
    function mi2(t3, e3) {
      if (!e3.streamNetworkBody) return function(t4) {
        return new Promise((e4) => {
          var r4 = setTimeout(() => e4(ci2), di2);
          try {
            t4.clone().text().then((t5) => e4(t5), (t5) => e4(fi2(t5))).finally(() => clearTimeout(r4));
          } catch (t5) {
            clearTimeout(r4), e4(vi2);
          }
        });
      }(t3);
      var r3 = zr2(e3);
      return function(t4, e4) {
        try {
          var r4, i3 = null == (r4 = t4.headers) || null == r4.get ? void 0 : r4.get("content-length");
          if (!i3) return false;
          var n3 = parseInt(i3, 10);
          return Number.isFinite(n3) && n3 > e4;
        } catch (t5) {
          return false;
        }
      }(t3, r3) ? Promise.resolve(pi2(r3)) : function(t4, e4) {
        return new Promise((r4) => {
          var i3, n3 = false;
          function s3() {
            try {
              var t5;
              null == (t5 = i3) || t5.cancel();
            } catch (t6) {
            }
          }
          function a3(t5) {
            n3 || (n3 = true, clearTimeout(u3), s3(), r4(t5));
          }
          var o3, u3 = setTimeout(() => a3(ci2), di2);
          try {
            o3 = t4.clone();
          } catch (t5) {
            return void a3(vi2);
          }
          var l3 = o3.body;
          if (hi2(l3) && "undefined" != typeof TextDecoder) {
            try {
              i3 = l3.getReader();
            } catch (t5) {
              return void a3(vi2);
            }
            var h3 = [], d3 = 0;
            !function t5() {
              i3.read().then((r5) => {
                var i4 = r5.done, o4 = r5.value;
                if (n3) s3();
                else if (i4) a3(new TextDecoder().decode(function(t6, e5) {
                  var r6 = new Uint8Array(e5), i5 = 0;
                  for (var n4 of t6) r6.set(n4, i5), i5 += n4.byteLength;
                  return r6;
                }(h3, d3)));
                else {
                  if (o4) {
                    if (d3 + o4.byteLength > e4) return void a3(pi2(e4));
                    d3 += o4.byteLength, h3.push(o4);
                  }
                  t5();
                }
              }, (t6) => a3(fi2(t6)));
            }();
          } else try {
            o3.text().then((t5) => a3(t5), (t5) => a3(fi2(t5)));
          } catch (t5) {
            a3(vi2);
          }
        });
      }(t3, r3);
    }
    function gi2() {
      return (gi2 = e2(function* (t3) {
        var e3 = t3.r, r3 = t3.options, i3 = Fr2(t3.url, r3);
        return i3.isHostDenied ? Promise.resolve(i3.hostname + " is in deny list") : mi2(e3, r3);
      })).apply(this, arguments);
    }
    function yi2() {
      return (yi2 = e2(function* (t3) {
        var e3 = t3.r, r3 = t3.options, i3 = function(t4) {
          var e4, r4 = t4.r, i4 = t4.options, n3 = t4.url;
          if ("chunked" === r4.headers.get("Transfer-Encoding")) return "Chunked Transfer-Encoding is not supported";
          var s3 = null == (e4 = r4.headers.get("Content-Type")) ? void 0 : e4.toLowerCase(), a3 = li2.some((t5) => null == s3 ? void 0 : s3.startsWith(t5));
          if (s3 && a3) return "Content-Type " + s3 + " is not supported";
          var o3 = Fr2(n3, i4);
          return o3.isHostDenied ? o3.hostname + " is in deny list" : null;
        }({ r: e3, options: r3, url: t3.url });
        return fr2(i3) ? mi2(e3, r3) : Promise.resolve(i3);
      })).apply(this, arguments);
    }
    var wi2 = null;
    function bi2(t3, i3, n3) {
      if (!("performance" in i3)) return () => {
      };
      if (wi2) return Xr2.warn("Network observer already initialised, doing nothing"), () => {
      };
      var s3 = n3 ? Object.assign({}, jr2, n3) : jr2, a3 = (e3) => {
        var i4 = [];
        e3.requests.forEach((t4) => {
          var e4 = s3.maskRequestFn(t4);
          e4 && i4.push(e4);
        }), i4.length > 0 && t3(r2({}, e3, { requests: i4 }));
      }, o3 = function(t4, e3, r3) {
        if (r3.recordInitialRequests) {
          var i4 = e3.performance.getEntries().filter((t5) => Kr2(t5) || Yr2(t5) && r3.initiatorTypes.includes(t5.initiatorType));
          t4({ requests: i4.flatMap((t5) => ui2({ entry: t5, method: void 0, status: void 0, networkRequest: {}, isInitial: true })), isInitial: true });
        }
        var n4 = new e3.PerformanceObserver((e4) => {
          var i5 = e4.getEntries().filter((t5) => Kr2(t5) || Yr2(t5) && r3.initiatorTypes.includes(t5.initiatorType) && ((t6) => !r3.recordBody && !r3.recordHeaders || "xmlhttprequest" !== t6.initiatorType && "fetch" !== t6.initiatorType)(t5));
          t4({ requests: i5.flatMap((t5) => ui2({ entry: t5, method: void 0, status: void 0, networkRequest: {} })) });
        }), s4 = PerformanceObserver.supportedEntryTypes.filter((t5) => r3.performanceEntryTypeToObserve.includes(t5));
        return n4.observe({ entryTypes: s4 }), () => {
          n4.disconnect();
        };
      }(a3, i3, s3), u3 = () => {
      }, l3 = () => {
      };
      return (s3.recordHeaders || s3.recordBody) && (u3 = function(t4, e3, r3) {
        if (!r3.initiatorTypes.includes("xmlhttprequest")) return () => {
        };
        var i4 = ti2("request", r3.recordHeaders), n4 = ti2("response", r3.recordHeaders), s4 = Lr2(e3.XMLHttpRequest.prototype, "open", (s5) => function(a4, o4, u4, l4, h3) {
          void 0 === u4 && (u4 = true);
          var d3 = this;
          try {
            var c3, v3, f3 = new Request(o4), p3 = {}, m3 = {}, g3 = d3.setRequestHeader.bind(d3);
            d3.setRequestHeader = (t5, e4) => (m3[t5] = e4, g3(t5, e4)), i4 && (p3.requestHeaders = m3);
            var y3 = d3.send.bind(d3);
            d3.send = (t5) => (ii2({ type: "request", headers: m3, url: o4, recordBody: r3.recordBody }) && (p3.requestBody = ai2({ body: t5, options: r3, url: o4 })), c3 = e3.performance.now(), y3(t5));
            var w3 = () => {
              d3.removeEventListener("readystatechange", b3), d3.removeEventListener("error", w3), d3.removeEventListener("abort", w3), d3.removeEventListener("timeout", w3);
            }, b3 = () => {
              if (d3.readyState === d3.DONE) {
                w3(), v3 = e3.performance.now();
                var i5 = {};
                d3.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach((t5) => {
                  var e4 = t5.split(": "), r4 = e4.shift(), n5 = e4.join(": ");
                  r4 && (i5[r4] = n5);
                }), n4 && (p3.responseHeaders = i5), ii2({ type: "response", headers: i5, url: o4, recordBody: r3.recordBody }) && (p3.responseBody = ai2({ body: d3.response, options: r3, url: o4 })), ni2(e3, "xmlhttprequest", f3.url, c3, v3).then((e4) => {
                  var r4 = ui2({ entry: e4, method: a4, status: null == d3 ? void 0 : d3.status, networkRequest: p3, start: c3, end: v3, url: o4.toString(), initiatorType: "xmlhttprequest" });
                  t4({ requests: r4 });
                }).catch(() => {
                });
              }
            };
            d3.addEventListener("readystatechange", b3), d3.addEventListener("error", w3), d3.addEventListener("abort", w3), d3.addEventListener("timeout", w3);
          } catch (t5) {
            Xr2.error("Failed to instrument XHR for network capture", t5);
          }
          s5.call(d3, a4, o4.toString(), u4, l4, h3);
        });
        return () => {
          s4();
        };
      }(a3, i3, s3), l3 = function(t4, r3, i4) {
        if (!i4.initiatorTypes.includes("fetch")) return () => {
        };
        var n4 = ti2("request", i4.recordHeaders), s4 = ti2("response", i4.recordHeaders), a4 = Lr2(r3, "fetch", (a5) => function() {
          var o4 = e2(function* (e3, o5) {
            var u4, l4;
            try {
              u4 = new Request(e3, o5);
            } catch (t5) {
              return Xr2.error("Failed to instrument fetch for network capture", t5), a5(e3, o5);
            }
            var h3, d3, c3 = {};
            try {
              try {
                var v3 = {};
                u4.headers.forEach((t5, e4) => {
                  v3[e4] = t5;
                }), n4 && (c3.requestHeaders = v3), !hi2(null == o5 ? void 0 : o5.body) && ii2({ type: "request", headers: v3, url: e3, recordBody: i4.recordBody }) && (c3.requestBody = yield function(t5) {
                  return gi2.apply(this, arguments);
                }({ r: u4, options: i4, url: e3 }));
              } catch (t5) {
                Xr2.error("Failed to record fetch request for network capture", t5);
              }
              h3 = r3.performance.now(), l4 = ei2(e3) ? yield a5(u4) : yield a5(e3, o5), d3 = r3.performance.now();
              var f3 = {};
              return l4.headers.forEach((t5, e4) => {
                f3[e4] = t5;
              }), s4 && (c3.responseHeaders = f3), ii2({ type: "response", headers: f3, url: e3, recordBody: i4.recordBody }) && (c3.responseBody = yield function(t5) {
                return yi2.apply(this, arguments);
              }({ r: l4, options: i4, url: e3 })), l4;
            } finally {
              ni2(r3, "fetch", u4.url, h3, d3).then((e4) => {
                var r4, i5 = ui2({ entry: e4, method: u4.method, status: null == (r4 = l4) ? void 0 : r4.status, networkRequest: c3, start: h3, end: d3, url: u4.url, initiatorType: "fetch" });
                t4({ requests: i5 });
              }).catch(() => {
              });
            }
          });
          return function(t5, e3) {
            return o4.apply(this, arguments);
          };
        }());
        return () => {
          a4();
        };
      }(a3, i3, s3)), wi2 = () => {
        o3(), u3(), l3(), wi2 = null;
      };
    }
    var ki2 = { DomContentLoaded: 0, Load: 1, FullSnapshot: 2, IncrementalSnapshot: 3, Meta: 4, Custom: 5, Plugin: 6 }, _i2 = { Mutation: 0, MouseMove: 1, MouseInteraction: 2, Scroll: 3, ViewportResize: 4, Input: 5, TouchMove: 6, MediaInteraction: 7, StyleSheetRule: 8, CanvasMutation: 9, Font: 10, Log: 11, Drag: 12, StyleDeclaration: 13, Selection: 14, AdoptedStyleSheet: 15, CustomElement: 16 }, Si2 = "$session_recording_remote_config", Ii2 = "$replay_sample_rate", Mi2 = "$replay_override_sampling", Ci2 = "$replay_override_linked_flag", xi2 = "$replay_override_url_trigger", Ri2 = "$replay_override_event_trigger", Ti2 = "$session_is_sampled", Oi2 = "$session_past_minimum_duration", Ai2 = "$session_recording_url_trigger_activated_session", Ei2 = "$session_recording_event_trigger_activated_session", Ni2 = "$posthog_sr_group_event_trigger_", Li2 = "$posthog_sr_group_url_trigger_", Fi2 = "$posthog_sr_group_sampling_", Di2 = "$debug_first_full_snapshot_timestamp", Pi2 = "$sess_rec_flush_size", Wi2 = "$stored_person_properties", Bi2 = "$sdk_debug_replay_remote_trigger_matching_config", $i2 = "disabled", Ui2 = "sampled", zi2 = "active", ji2 = "buffering", qi2 = "paused", Hi2 = "rrweb_error", Gi2 = "trigger", Vi2 = Gi2 + "_activated", Zi2 = Gi2 + "_pending", Ji2 = Gi2 + "_" + $i2;
    function Qi2(t3, e3, r3, i3, n3, s3) {
      return 0 === e3 ? Ji2 : (null == t3 ? void 0 : t3.get_property(r3 ? i3 + r3 : n3)) === s3 ? Vi2 : Zi2;
    }
    function Xi2(t3, e3, r3) {
      return e3.some((e4) => {
        var i3;
        return "regex" === e4.matching && (null !== (i3 = null == r3 ? void 0 : r3.get(e4.url)) && void 0 !== i3 ? i3 : new RegExp(e4.url)).test(t3);
      });
    }
    class Ki2 {
      constructor(t3) {
        this.u = t3;
      }
      triggerStatus(t3) {
        var e3 = this.u.map((e4) => e4.triggerStatus(t3));
        return e3.includes(Vi2) ? Vi2 : e3.includes(Zi2) ? Zi2 : Ji2;
      }
      stop() {
        this.u.forEach((t3) => t3.stop());
      }
    }
    class Yi2 {
      constructor(t3) {
        this.u = t3;
      }
      triggerStatus(t3) {
        var e3 = /* @__PURE__ */ new Set();
        for (var r3 of this.u) e3.add(r3.triggerStatus(t3));
        switch (e3.delete(Ji2), e3.size) {
          case 0:
            return Ji2;
          case 1:
            return Array.from(e3)[0];
          default:
            return Zi2;
        }
      }
      stop() {
        this.u.forEach((t3) => t3.stop());
      }
    }
    class tn2 {
      triggerStatus() {
        return Vi2;
      }
      stop() {
      }
    }
    var en2 = (t3) => "sessionRecording" in t3;
    class rn2 {
      constructor(t3, e3) {
        this.ju = [], this.Gu = [], this.Vu = /* @__PURE__ */ new Map(), this.Zu = /* @__PURE__ */ new Map(), this.Ju = "", this.urlBlocked = false, this._instance = t3, this.Qu = e3;
      }
      onConfig(t3) {
        var e3, r3;
        this.ju = (en2(t3) ? dr2(t3.sessionRecording) ? null == (e3 = t3.sessionRecording) ? void 0 : e3.urlTriggers : [] : null == t3 ? void 0 : t3.urlTriggers) || [], this.Gu = (en2(t3) ? dr2(t3.sessionRecording) ? null == (r3 = t3.sessionRecording) ? void 0 : r3.urlBlocklist : [] : null == t3 ? void 0 : t3.urlBlocklist) || [], this.Xu();
      }
      Xu() {
        for (var t3 of (this.Vu.clear(), this.Zu.clear(), this.ju)) if ("regex" === t3.matching && !this.Vu.has(t3.url)) try {
          this.Vu.set(t3.url, new RegExp(t3.url));
        } catch (e4) {
          Cr2.error("Invalid URL trigger regex pattern:", t3.url, e4);
        }
        for (var e3 of this.Gu) if ("regex" === e3.matching && !this.Zu.has(e3.url)) try {
          this.Zu.set(e3.url, new RegExp(e3.url));
        } catch (t4) {
          Cr2.error("Invalid URL blocklist regex pattern:", e3.url, t4);
        }
      }
      onRemoteConfig(t3) {
        this.onConfig(t3);
      }
      Ku(t3) {
        return Qi2(this._instance, this.ju.length, this.Qu, Li2, Ai2, t3);
      }
      triggerStatus(t3) {
        var e3 = this.Ku(t3), r3 = e3 === Vi2 ? Vi2 : e3 === Zi2 ? Zi2 : Ji2;
        return this._instance.register_for_session({ $sdk_debug_replay_url_trigger_status: r3 }), r3;
      }
      checkUrlBlocklist(t3, e3) {
        var r3 = Dr2(this._instance);
        if (r3 && r3 !== this.Ju) {
          this.Ju = r3;
          var i3 = this.urlBlocked, n3 = Xi2(r3, this.Gu, this.Zu);
          i3 && n3 || (n3 && !i3 ? t3() : !n3 && i3 && e3());
        }
      }
      checkUrlTriggerConditions(t3, e3, r3, i3) {
        var n3 = Dr2(this._instance);
        if (n3 && n3 !== this.Ju) {
          this.Ju = n3;
          var s3 = this.urlBlocked, a3 = Xi2(n3, this.Gu, this.Zu);
          a3 && !s3 ? t3() : !a3 && s3 && e3();
          var o3 = this.Ku(i3) === Vi2, u3 = Xi2(n3, this.ju, this.Vu);
          !o3 && u3 && r3("url", n3);
        }
      }
      stop() {
        this.Ju = "";
      }
    }
    class nn2 {
      constructor(t3) {
        this.linkedFlag = null, this.linkedFlagSeen = false, this.Yu = () => {
        }, this._instance = t3;
      }
      triggerStatus() {
        var t3 = Zi2;
        return pr2(this.linkedFlag) && (t3 = Ji2), this.linkedFlagSeen && (t3 = Vi2), this._instance.register_for_session({ $sdk_debug_replay_linked_flag_trigger_status: t3 }), t3;
      }
      onConfig(t3, e3) {
        var r3;
        if (this.linkedFlag = (en2(t3) ? dr2(t3.sessionRecording) ? null == (r3 = t3.sessionRecording) ? void 0 : r3.linkedFlag : null : null == t3 ? void 0 : t3.linkedFlag) || null, !pr2(this.linkedFlag) && !this.linkedFlagSeen) {
          var i3 = vr2(this.linkedFlag) ? this.linkedFlag : this.linkedFlag.flag, n3 = vr2(this.linkedFlag) ? null : this.linkedFlag.variant;
          this.Yu = this._instance.onFeatureFlags((t4, r4) => {
            var s3 = false;
            if (dr2(r4) && i3 in r4) {
              var a3 = r4[i3];
              s3 = gr2(a3) ? true === a3 : n3 ? a3 === n3 : !!a3;
            }
            var o3 = s3 && !this.linkedFlagSeen;
            this.linkedFlagSeen = s3, o3 && e3(i3, n3);
          });
        }
      }
      onRemoteConfig(t3, e3) {
        this.onConfig(t3, e3);
      }
      stop() {
        this.Yu();
      }
    }
    class sn2 {
      constructor(t3, e3) {
        this.th = [], this._instance = t3, this.Qu = e3;
      }
      onConfig(t3) {
        var e3;
        this.th = (en2(t3) ? dr2(t3.sessionRecording) ? null == (e3 = t3.sessionRecording) ? void 0 : e3.eventTriggers : [] : null == t3 ? void 0 : t3.eventTriggers) || [];
      }
      onRemoteConfig(t3) {
        this.onConfig(t3);
      }
      eh(t3) {
        return Qi2(this._instance, this.th.length, this.Qu, Ni2, Ei2, t3);
      }
      triggerStatus(t3) {
        var e3 = this.eh(t3), r3 = e3 === Vi2 ? Vi2 : e3 === Zi2 ? Zi2 : Ji2;
        return this._instance.register_for_session({ $sdk_debug_replay_event_trigger_status: r3 }), r3;
      }
      checkEventTriggerConditions(t3, e3, r3) {
        if (0 !== this.th.length) {
          var i3 = this.eh(r3) === Vi2, n3 = this.th.includes(t3);
          !i3 && n3 && e3("event", t3);
        }
      }
      stop() {
      }
    }
    class an2 {
      constructor(t3, e3, r3) {
        if (this._instance = t3, this.group = e3, this.rh = new rn2(t3, e3.id), this.ih = new sn2(t3, e3.id), this.nh = new nn2(t3), e3.conditions.events && e3.conditions.events.length > 0 || e3.conditions.urls && e3.conditions.urls.length > 0 || e3.conditions.flag) {
          var i3 = (e3.conditions.events || []).map((t4) => t4.name), n3 = { urlTriggers: e3.conditions.urls || [], eventTriggers: i3, linkedFlag: e3.conditions.flag || null, urlBlocklist: [] };
          this.rh.onConfig(n3), this.ih.onConfig(n3), this.nh.onConfig(n3, r3);
          var s3 = [this.ih, this.rh, this.nh];
          this.sh = "any" === e3.conditions.matchType ? new Ki2(s3) : new Yi2(s3);
        } else this.sh = new tn2();
      }
      triggerStatus(t3) {
        return this.sh.triggerStatus(t3);
      }
      checkEventTriggerConditions(t3, e3, r3) {
        this.ih.checkEventTriggerConditions(t3, e3, r3);
      }
      checkUrlTriggerConditions(t3, e3, r3, i3) {
        this.rh.checkUrlTriggerConditions(t3, e3, r3, i3);
      }
      activateTrigger(t3, e3) {
        var r3;
        null == (r3 = this._instance.persistence) || r3.register({ ["url" === t3 ? Li2 + this.group.id : Ni2 + this.group.id]: e3 });
      }
      stop() {
        this.rh.stop(), this.ih.stop(), this.nh.stop();
      }
    }
    function on2(t3) {
      if (t3.rrwebError) return Hi2;
      if (!t3.receivedFlags) return ji2;
      if (!t3.isRecordingEnabled) return $i2;
      if (t3.urlTriggerMatching.urlBlocked) return qi2;
      var e3 = true === t3.isSampled, r3 = new Ki2([t3.eventTriggerMatching, t3.urlTriggerMatching, t3.linkedFlagMatching]).triggerStatus(t3.sessionId);
      return e3 ? Ui2 : r3 === Vi2 ? zi2 : r3 === Zi2 ? ji2 : false === t3.isSampled ? $i2 : zi2;
    }
    function un2(t3) {
      if (t3.rrwebError) return Hi2;
      if (!t3.receivedFlags) return ji2;
      if (!t3.isRecordingEnabled) return $i2;
      if (t3.urlTriggerMatching.urlBlocked) return qi2;
      var e3 = new Yi2([t3.eventTriggerMatching, t3.urlTriggerMatching, t3.linkedFlagMatching]).triggerStatus(t3.sessionId), r3 = e3 !== Ji2, i3 = gr2(t3.isSampled);
      return r3 && e3 === Zi2 ? ji2 : r3 && e3 === Ji2 || i3 && !t3.isSampled ? $i2 : true === t3.isSampled ? Ui2 : zi2;
    }
    function ln2() {
      var t3 = [];
      return function(e3, r3) {
        if (dr2(r3) || lr2(r3)) {
          for (; t3.length > 0 && t3[t3.length - 1] !== this; ) t3.pop();
          return t3.includes(r3) ? "[Circular]" : (t3.push(r3), r3);
        }
        return r3;
      };
    }
    function hn2(t3) {
      var e3 = JSON.stringify(t3, ln2());
      return e3 ? new Blob([e3]).size : 0;
    }
    function dn2(t3) {
      if (fr2(t3)) return 4;
      if (cr2(t3)) return 0;
      switch (typeof t3) {
        case "string":
          return t3.length + 2;
        case "number":
          return String(t3).length;
        case "boolean":
          return t3 ? 4 : 5;
        case "object":
          if (lr2(t3)) {
            for (var e3 = 2, r3 = 0; t3.length > r3; r3++) {
              r3 > 0 && (e3 += 1);
              var i3 = t3[r3];
              e3 += cr2(i3) || fr2(i3) ? 4 : dn2(i3);
            }
            return e3;
          }
          var n3 = t3, s3 = 2, a3 = true;
          for (var o3 in n3) if ({}.hasOwnProperty.call(n3, o3)) {
            var u3 = n3[o3];
            cr2(u3) || (a3 || (s3 += 1), a3 = false, s3 += o3.length + 3 + dn2(u3));
          }
          return s3;
        default:
          return 0;
      }
    }
    function cn2(t3, e3) {
      if (void 0 === e3 && (e3 = 66060288e-1), t3.size >= e3 && t3.data.length > 1) {
        var r3 = Math.floor(t3.data.length / 2), i3 = t3.sizes.slice(0, r3), n3 = t3.sizes.slice(r3);
        return [cn2({ size: i3.reduce((t4, e4) => t4 + e4, 0), data: t3.data.slice(0, r3), sizes: i3, sessionId: t3.sessionId, windowId: t3.windowId }), cn2({ size: n3.reduce((t4, e4) => t4 + e4, 0), data: t3.data.slice(r3), sizes: n3, sessionId: t3.sessionId, windowId: t3.windowId })].flatMap((t4) => t4);
      }
      return [t3];
    }
    var vn2 = Uint8Array, fn2 = Uint16Array, pn2 = Uint32Array, mn2 = new vn2([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]), gn2 = new vn2([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]), yn2 = new vn2([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), wn2 = function(t3, e3) {
      for (var r3 = new fn2(31), i3 = 0; 31 > i3; ++i3) r3[i3] = e3 += 1 << t3[i3 - 1];
      var n3 = new pn2(r3[30]);
      for (i3 = 1; 30 > i3; ++i3) for (var s3 = r3[i3]; r3[i3 + 1] > s3; ++s3) n3[s3] = s3 - r3[i3] << 5 | i3;
      return [r3, n3];
    }, bn2 = wn2(mn2, 2), kn2 = bn2[1];
    bn2[0][28] = 258, kn2[258] = 28;
    for (var _n2 = wn2(gn2, 0)[1], Sn2 = new fn2(32768), In2 = 0; 32768 > In2; ++In2) {
      var Mn2 = (43690 & In2) >>> 1 | (21845 & In2) << 1;
      Sn2[In2] = ((65280 & (Mn2 = (61680 & (Mn2 = (52428 & Mn2) >>> 2 | (13107 & Mn2) << 2)) >>> 4 | (3855 & Mn2) << 4)) >>> 8 | (255 & Mn2) << 8) >>> 1;
    }
    var Cn2 = function(t3, e3, r3) {
      for (var i3 = t3.length, n3 = 0, s3 = new fn2(e3); i3 > n3; ++n3) ++s3[t3[n3] - 1];
      var a3, o3 = new fn2(e3);
      for (n3 = 0; e3 > n3; ++n3) o3[n3] = o3[n3 - 1] + s3[n3 - 1] << 1;
      if (r3) {
        a3 = new fn2(1 << e3);
        var u3 = 15 - e3;
        for (n3 = 0; i3 > n3; ++n3) if (t3[n3]) for (var l3 = n3 << 4 | t3[n3], h3 = e3 - t3[n3], d3 = o3[t3[n3] - 1]++ << h3, c3 = d3 | (1 << h3) - 1; c3 >= d3; ++d3) a3[Sn2[d3] >>> u3] = l3;
      } else for (a3 = new fn2(i3), n3 = 0; i3 > n3; ++n3) a3[n3] = Sn2[o3[t3[n3] - 1]++] >>> 15 - t3[n3];
      return a3;
    }, xn2 = new vn2(288);
    for (In2 = 0; 144 > In2; ++In2) xn2[In2] = 8;
    for (In2 = 144; 256 > In2; ++In2) xn2[In2] = 9;
    for (In2 = 256; 280 > In2; ++In2) xn2[In2] = 7;
    for (In2 = 280; 288 > In2; ++In2) xn2[In2] = 8;
    var Rn2 = new vn2(32);
    for (In2 = 0; 32 > In2; ++In2) Rn2[In2] = 5;
    var Tn2 = Cn2(xn2, 9, 0), On = Cn2(Rn2, 5, 0), An2 = function(t3) {
      return (t3 / 8 >> 0) + (7 & t3 && 1);
    }, En2 = function(t3, e3, r3) {
      (null == r3 || r3 > t3.length) && (r3 = t3.length);
      var i3 = new (t3 instanceof fn2 ? fn2 : t3 instanceof pn2 ? pn2 : vn2)(r3 - e3);
      return i3.set(t3.subarray(e3, r3)), i3;
    }, Nn = function(t3, e3, r3) {
      var i3 = e3 / 8 >> 0;
      t3[i3] |= r3 <<= 7 & e3, t3[i3 + 1] |= r3 >>> 8;
    }, Ln2 = function(t3, e3, r3) {
      var i3 = e3 / 8 >> 0;
      t3[i3] |= r3 <<= 7 & e3, t3[i3 + 1] |= r3 >>> 8, t3[i3 + 2] |= r3 >>> 16;
    }, Fn2 = function(t3, e3) {
      for (var r3 = [], i3 = 0; t3.length > i3; ++i3) t3[i3] && r3.push({ s: i3, f: t3[i3] });
      var n3 = r3.length, s3 = r3.slice();
      if (!n3) return [new vn2(0), 0];
      if (1 == n3) {
        var a3 = new vn2(r3[0].s + 1);
        return a3[r3[0].s] = 1, [a3, 1];
      }
      r3.sort(function(t4, e4) {
        return t4.f - e4.f;
      }), r3.push({ s: -1, f: 25001 });
      var o3 = r3[0], u3 = r3[1], l3 = 0, h3 = 1, d3 = 2;
      for (r3[0] = { s: -1, f: o3.f + u3.f, l: o3, r: u3 }; h3 != n3 - 1; ) o3 = r3[r3[d3].f > r3[l3].f ? l3++ : d3++], u3 = r3[l3 != h3 && r3[d3].f > r3[l3].f ? l3++ : d3++], r3[h3++] = { s: -1, f: o3.f + u3.f, l: o3, r: u3 };
      var c3 = s3[0].s;
      for (i3 = 1; n3 > i3; ++i3) s3[i3].s > c3 && (c3 = s3[i3].s);
      var v3 = new fn2(c3 + 1), f3 = Dn(r3[h3 - 1], v3, 0);
      if (f3 > e3) {
        i3 = 0;
        var p3 = 0, m3 = f3 - e3, g3 = 1 << m3;
        for (s3.sort(function(t4, e4) {
          return v3[e4.s] - v3[t4.s] || t4.f - e4.f;
        }); n3 > i3; ++i3) {
          var y3 = s3[i3].s;
          if (e3 >= v3[y3]) break;
          p3 += g3 - (1 << f3 - v3[y3]), v3[y3] = e3;
        }
        for (p3 >>>= m3; p3 > 0; ) {
          var w3 = s3[i3].s;
          e3 > v3[w3] ? p3 -= 1 << e3 - v3[w3]++ - 1 : ++i3;
        }
        for (; i3 >= 0 && p3; --i3) {
          var b3 = s3[i3].s;
          v3[b3] == e3 && (--v3[b3], ++p3);
        }
        f3 = e3;
      }
      return [new vn2(v3), f3];
    }, Dn = function(t3, e3, r3) {
      return -1 == t3.s ? Math.max(Dn(t3.l, e3, r3 + 1), Dn(t3.r, e3, r3 + 1)) : e3[t3.s] = r3;
    }, Pn2 = function(t3) {
      for (var e3 = t3.length; e3 && !t3[--e3]; ) ;
      for (var r3 = new fn2(++e3), i3 = 0, n3 = t3[0], s3 = 1, a3 = function(t4) {
        r3[i3++] = t4;
      }, o3 = 1; e3 >= o3; ++o3) if (t3[o3] == n3 && o3 != e3) ++s3;
      else {
        if (!n3 && s3 > 2) {
          for (; s3 > 138; s3 -= 138) a3(32754);
          s3 > 2 && (a3(s3 > 10 ? s3 - 11 << 5 | 28690 : s3 - 3 << 5 | 12305), s3 = 0);
        } else if (s3 > 3) {
          for (a3(n3), --s3; s3 > 6; s3 -= 6) a3(8304);
          s3 > 2 && (a3(s3 - 3 << 5 | 8208), s3 = 0);
        }
        for (; s3--; ) a3(n3);
        s3 = 1, n3 = t3[o3];
      }
      return [r3.subarray(0, i3), e3];
    }, Wn = function(t3, e3) {
      for (var r3 = 0, i3 = 0; e3.length > i3; ++i3) r3 += t3[i3] * e3[i3];
      return r3;
    }, Bn2 = function(t3, e3, r3) {
      var i3 = r3.length, n3 = An2(e3 + 2);
      t3[n3] = 255 & i3, t3[n3 + 1] = i3 >>> 8, t3[n3 + 2] = 255 ^ t3[n3], t3[n3 + 3] = 255 ^ t3[n3 + 1];
      for (var s3 = 0; i3 > s3; ++s3) t3[n3 + s3 + 4] = r3[s3];
      return 8 * (n3 + 4 + i3);
    }, $n2 = function(t3, e3, r3, i3, n3, s3, a3, o3, u3, l3, h3) {
      Nn(e3, h3++, r3), ++n3[256];
      for (var d3 = Fn2(n3, 15), c3 = d3[0], v3 = d3[1], f3 = Fn2(s3, 15), p3 = f3[0], m3 = f3[1], g3 = Pn2(c3), y3 = g3[0], w3 = g3[1], b3 = Pn2(p3), k3 = b3[0], _3 = b3[1], S3 = new fn2(19), I3 = 0; y3.length > I3; ++I3) S3[31 & y3[I3]]++;
      for (I3 = 0; k3.length > I3; ++I3) S3[31 & k3[I3]]++;
      for (var M3 = Fn2(S3, 7), C3 = M3[0], x3 = M3[1], R3 = 19; R3 > 4 && !C3[yn2[R3 - 1]]; --R3) ;
      var T3, O3, A3, E3, N3 = l3 + 5 << 3, L3 = Wn(n3, xn2) + Wn(s3, Rn2) + a3, F3 = Wn(n3, c3) + Wn(s3, p3) + a3 + 14 + 3 * R3 + Wn(S3, C3) + (2 * S3[16] + 3 * S3[17] + 7 * S3[18]);
      if (L3 >= N3 && F3 >= N3) return Bn2(e3, h3, t3.subarray(u3, u3 + l3));
      if (Nn(e3, h3, 1 + (L3 > F3)), h3 += 2, L3 > F3) {
        T3 = Cn2(c3, v3, 0), O3 = c3, A3 = Cn2(p3, m3, 0), E3 = p3;
        var D3 = Cn2(C3, x3, 0);
        for (Nn(e3, h3, w3 - 257), Nn(e3, h3 + 5, _3 - 1), Nn(e3, h3 + 10, R3 - 4), h3 += 14, I3 = 0; R3 > I3; ++I3) Nn(e3, h3 + 3 * I3, C3[yn2[I3]]);
        h3 += 3 * R3;
        for (var P3 = [y3, k3], W3 = 0; 2 > W3; ++W3) {
          var B3 = P3[W3];
          for (I3 = 0; B3.length > I3; ++I3) Nn(e3, h3, D3[U3 = 31 & B3[I3]]), h3 += C3[U3], U3 > 15 && (Nn(e3, h3, B3[I3] >>> 5 & 127), h3 += B3[I3] >>> 12);
        }
      } else T3 = Tn2, O3 = xn2, A3 = On, E3 = Rn2;
      for (I3 = 0; o3 > I3; ++I3) if (i3[I3] > 255) {
        var U3;
        Ln2(e3, h3, T3[257 + (U3 = i3[I3] >>> 18 & 31)]), h3 += O3[U3 + 257], U3 > 7 && (Nn(e3, h3, i3[I3] >>> 23 & 31), h3 += mn2[U3]);
        var z3 = 31 & i3[I3];
        Ln2(e3, h3, A3[z3]), h3 += E3[z3], z3 > 3 && (Ln2(e3, h3, i3[I3] >>> 5 & 8191), h3 += gn2[z3]);
      } else Ln2(e3, h3, T3[i3[I3]]), h3 += O3[i3[I3]];
      return Ln2(e3, h3, T3[256]), h3 + O3[256];
    }, Un = new pn2([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]), zn2 = function() {
      for (var t3 = new pn2(256), e3 = 0; 256 > e3; ++e3) {
        for (var r3 = e3, i3 = 9; --i3; ) r3 = (1 & r3 && 3988292384) ^ r3 >>> 1;
        t3[e3] = r3;
      }
      return t3;
    }(), jn2 = function() {
      var t3 = 4294967295;
      return { p(e3) {
        for (var r3 = t3, i3 = 0; e3.length > i3; ++i3) r3 = zn2[255 & r3 ^ e3[i3]] ^ r3 >>> 8;
        t3 = r3;
      }, d: () => 4294967295 ^ t3 };
    }, qn = function(t3, e3, r3, i3, n3) {
      return function(t4, e4, r4, i4, n4, s3) {
        var a3 = t4.length, o3 = new vn2(i4 + a3 + 5 * (1 + Math.floor(a3 / 7e3)) + n4), u3 = o3.subarray(i4, o3.length - n4), l3 = 0;
        if (!e4 || 8 > a3) for (var h3 = 0; a3 >= h3; h3 += 65535) {
          var d3 = h3 + 65535;
          a3 > d3 ? l3 = Bn2(u3, l3, t4.subarray(h3, d3)) : (u3[h3] = true, l3 = Bn2(u3, l3, t4.subarray(h3, a3)));
        }
        else {
          for (var c3 = Un[e4 - 1], v3 = c3 >>> 13, f3 = 8191 & c3, p3 = (1 << r4) - 1, m3 = new fn2(32768), g3 = new fn2(p3 + 1), y3 = Math.ceil(r4 / 3), w3 = 2 * y3, b3 = function(e5) {
            return (t4[e5] ^ t4[e5 + 1] << y3 ^ t4[e5 + 2] << w3) & p3;
          }, k3 = new pn2(25e3), _3 = new fn2(288), S3 = new fn2(32), I3 = 0, M3 = 0, C3 = (h3 = 0, 0), x3 = 0, R3 = 0; a3 > h3; ++h3) {
            var T3 = b3(h3), O3 = 32767 & h3, A3 = g3[T3];
            if (m3[O3] = A3, g3[T3] = O3, h3 >= x3) {
              var E3 = a3 - h3;
              if ((I3 > 7e3 || C3 > 24576) && E3 > 423) {
                l3 = $n2(t4, u3, 0, k3, _3, S3, M3, C3, R3, h3 - R3, l3), C3 = I3 = M3 = 0, R3 = h3;
                for (var N3 = 0; 286 > N3; ++N3) _3[N3] = 0;
                for (N3 = 0; 30 > N3; ++N3) S3[N3] = 0;
              }
              var L3 = 2, F3 = 0, D3 = f3, P3 = O3 - A3 & 32767;
              if (E3 > 2 && T3 == b3(h3 - P3)) for (var W3 = Math.min(v3, E3) - 1, B3 = Math.min(32767, h3), U3 = Math.min(258, E3); B3 >= P3 && --D3 && O3 != A3; ) {
                if (t4[h3 + L3] == t4[h3 + L3 - P3]) {
                  for (var z3 = 0; U3 > z3 && t4[h3 + z3] == t4[h3 + z3 - P3]; ++z3) ;
                  if (z3 > L3) {
                    if (L3 = z3, F3 = P3, z3 > W3) break;
                    var j3 = Math.min(P3, z3 - 2), q3 = 0;
                    for (N3 = 0; j3 > N3; ++N3) {
                      var H3 = h3 - P3 + N3 + 32768 & 32767, G3 = H3 - m3[H3] + 32768 & 32767;
                      G3 > q3 && (q3 = G3, A3 = H3);
                    }
                  }
                }
                P3 += (O3 = A3) - (A3 = m3[O3]) + 32768 & 32767;
              }
              if (F3) {
                k3[C3++] = 268435456 | kn2[L3] << 18 | _n2[F3];
                var V3 = 31 & kn2[L3], Z3 = 31 & _n2[F3];
                M3 += mn2[V3] + gn2[Z3], ++_3[257 + V3], ++S3[Z3], x3 = h3 + L3, ++I3;
              } else k3[C3++] = t4[h3], ++_3[t4[h3]];
            }
          }
          l3 = $n2(t4, u3, true, k3, _3, S3, M3, C3, R3, h3 - R3, l3);
        }
        return En2(o3, 0, i4 + An2(l3) + n4);
      }(t3, null == e3.level ? 6 : e3.level, null == e3.mem ? Math.ceil(1.5 * Math.max(8, Math.min(13, Math.log(t3.length)))) : 12 + e3.mem, r3, i3);
    }, Hn = function(t3, e3, r3) {
      for (; r3; ++e3) t3[e3] = r3, r3 >>>= 8;
    }, Gn2 = function(t3, e3) {
      var r3 = e3.filename;
      if (t3[0] = 31, t3[1] = 139, t3[2] = 8, t3[8] = 2 > e3.level ? 4 : 9 == e3.level ? 2 : 0, t3[9] = 3, 0 != e3.mtime && Hn(t3, 4, Math.floor(new Date(e3.mtime || Date.now()) / 1e3)), r3) {
        t3[3] = 8;
        for (var i3 = 0; r3.length >= i3; ++i3) t3[i3 + 10] = r3.charCodeAt(i3);
      }
    }, Vn2 = function(t3) {
      return 10 + (t3.filename && t3.filename.length + 1 || 0);
    };
    function Zn2(t3, e3) {
      for (var r3 = "", i3 = 0; t3.length > i3; ) {
        var n3 = t3[i3++];
        r3 += String.fromCharCode(n3);
      }
      return r3;
    }
    class Jn2 {
      constructor(t3, e3) {
        var r3, i3;
        void 0 === e3 && (e3 = {}), this.ah = {}, this.oh = (t4) => {
          if (!this.ah[t4]) {
            var e4, r4;
            this.ah[t4] = true;
            var i4 = this.uh(t4);
            null == (e4 = (r4 = this.lh).onBlockedNode) || e4.call(r4, t4, i4);
          }
        }, this.hh = (t4) => {
          var e4 = this.uh(t4);
          if ("svg" !== (null == e4 ? void 0 : e4.nodeName) && e4 instanceof Element) {
            var r4 = e4.closest("svg");
            if (r4) return [this._rrweb.mirror.getId(r4), r4];
          }
          return [t4, e4];
        }, this.uh = (t4) => this._rrweb.mirror.getNode(t4), this.dh = (t4) => {
          var e4, r4, i4, n3, s3, a3, o3, u3;
          return (null !== (e4 = null == (r4 = t4.removes) ? void 0 : r4.length) && void 0 !== e4 ? e4 : 0) + (null !== (i4 = null == (n3 = t4.attributes) ? void 0 : n3.length) && void 0 !== i4 ? i4 : 0) + (null !== (s3 = null == (a3 = t4.texts) ? void 0 : a3.length) && void 0 !== s3 ? s3 : 0) + (null !== (o3 = null == (u3 = t4.adds) ? void 0 : u3.length) && void 0 !== o3 ? o3 : 0);
        }, this.throttleMutations = (t4) => {
          if (3 !== t4.type || 0 !== t4.data.source) return t4;
          var e4 = t4.data, r4 = this.dh(e4);
          e4.attributes && (e4.attributes = e4.attributes.filter((t5) => {
            var e5 = this.hh(t5.id);
            return !this.Xo.consumeRateLimit(e5[0]) && t5;
          }));
          var i4 = this.dh(e4);
          return 0 !== i4 || r4 === i4 ? t4 : void 0;
        }, this._rrweb = t3, this.lh = e3, this.Xo = new br2({ bucketSize: null !== (r3 = this.lh.bucketSize) && void 0 !== r3 ? r3 : 100, refillRate: null !== (i3 = this.lh.refillRate) && void 0 !== i3 ? i3 : 10, refillInterval: 1e3, et: this.oh, it: Cr2 });
      }
      reset() {
        this.ah = {};
      }
      stop() {
        this.Xo.stop(), this.reset();
      }
    }
    var Qn2 = "1.407.2";
    Ir2.DEBUG = false, Ir2.LIB_VERSION = Qn2, Ir2.LIB_NAME = "web", Ir2.JS_SDK_VERSION = Qn2;
    class Xn {
      constructor(t3) {
        if (!t3.persistence) throw new Error("it is not valid to not have persistence and be this far into setting up the application");
        this.fh = t3.get_property.bind(t3), this.ph = t3.persistence.set_property.bind(t3.persistence);
      }
      trackSize(t3, e3) {
        this.ph(Pi2, { sessionId: t3, size: this.currentTrackedSize(t3) + e3 });
      }
      currentTrackedSize(t3) {
        var e3, r3 = this.fh(Pi2);
        return dr2(e3 = r3) && vr2(e3.sessionId) && mr2(e3.size) && r3.sessionId === t3 ? r3.size : 0;
      }
    }
    function Kn2(t3, e3) {
      return function(t4) {
        for (var e4 = 0, r3 = 0; t4.length > r3; r3++) e4 = (e4 << 5) - e4 + t4.charCodeAt(r3), e4 |= 0;
        return Math.abs(e4);
      }(t3) % 100 < wr2(100 * e3, 0, 100, Cr2);
    }
    var Yn2 = function(t3, e3) {
      if (!function(t4) {
        try {
          new RegExp(t4);
        } catch (t5) {
          return false;
        }
        return true;
      }(e3)) return false;
      try {
        return new RegExp(e3).test(t3);
      } catch (t4) {
        return false;
      }
    }, ts2 = { exact: (t3, e3) => e3.some((e4) => t3.some((t4) => e4 === t4)), is_not: (t3, e3) => e3.every((e4) => t3.every((t4) => e4 !== t4)), regex: (t3, e3) => e3.some((e4) => t3.some((t4) => Yn2(e4, t4))), not_regex: (t3, e3) => e3.every((e4) => t3.every((t4) => !Yn2(e4, t4))), icontains: (t3, e3) => e3.map(es2).some((e4) => t3.map(es2).some((t4) => e4.includes(t4))), not_icontains: (t3, e3) => e3.map(es2).every((e4) => t3.map(es2).every((t4) => !e4.includes(t4))), gt: (t3, e3) => e3.some((e4) => {
      var r3 = parseFloat(e4);
      return !isNaN(r3) && t3.some((t4) => r3 > parseFloat(t4));
    }), lt: (t3, e3) => e3.some((e4) => {
      var r3 = parseFloat(e4);
      return !isNaN(r3) && t3.some((t4) => r3 < parseFloat(t4));
    }) }, es2 = (t3) => t3.toLowerCase(), rs2 = /* @__PURE__ */ new Set(["is_not", "not_icontains", "not_regex"]);
    function is2(t3, e3, r3) {
      return !t3 || 0 === t3.length || t3.every((t4) => {
        var i3 = "person" === t4.type ? r3 : e3, n3 = null == i3 ? void 0 : i3[t4.key], s3 = t4.operator || "exact";
        if (cr2(n3) || fr2(n3)) return rs2.has(s3);
        var a3 = ts2[s3];
        return !!a3 && !cr2(t4.value) && !fr2(t4.value) && a3(lr2(t4.value) ? t4.value.map(String) : [String(t4.value)], lr2(n3) ? n3.map(String) : [String(n3)]);
      });
    }
    var ns2 = xr2("[SessionRecording]");
    function ss2(t3, e3) {
      return e3 ? t3 : "!" + t3;
    }
    function as2(t3, e3) {
      return t3 === e3 || t3 !== "!" + e3 && null;
    }
    class os2 {
      constructor(t3, e3, r3, i3, n3, s3, a3) {
        this.mh = null, this.gh = un2, this._instance = t3, this.rh = e3, this.ih = r3, this.nh = i3, this.yh = n3, this.wh = s3, this.bh = a3;
      }
      onRemoteConfig(t3) {
        this.mh = mr2(t3.sampleRate) ? t3.sampleRate : null, "any" === t3.triggerMatchType ? (this.kh = new Ki2([this.ih, this.rh]), this.gh = on2) : (this.kh = new Yi2([this.ih, this.rh]), this.gh = un2), this._instance.register_for_session({ [Bi2]: t3.triggerMatchType }), this.rh.onConfig(t3), this.ih.onConfig(t3), this.nh.onConfig(t3, (t4, e3) => {
          this.yh("linked_flag_matched", { flag: t4, variant: e3 }), this.bh();
        });
      }
      getStatus(t3) {
        return this.gh({ receivedFlags: true, isRecordingEnabled: true, isSampled: t3.isSampled, rrwebError: t3.rrwebError, urlTriggerMatching: t3.urlTriggerMatching, eventTriggerMatching: t3.eventTriggerMatching, linkedFlagMatching: t3.linkedFlagMatching, sessionId: t3.sessionId });
      }
      getMinimumDuration(t3) {
        var e3 = this._instance.get_property("$session_recording_remote_config"), r3 = null == e3 ? void 0 : e3.minimumDurationMilliseconds;
        return mr2(r3) ? r3 : null;
      }
      checkUrlTriggers(t3, e3, r3, i3) {
        this.rh.checkUrlTriggerConditions(e3, r3, i3, t3);
      }
      setupEventTriggerListeners(t3, e3, r3) {
        if (0 !== this.ih.th.length && pr2(this._h)) return this._h = t3((t4) => {
          try {
            this.ih.checkEventTriggerConditions(t4.event, r3, e3);
          } catch (t5) {
            ns2.error("Could not activate event trigger", t5);
          }
        }), this._h;
      }
      makeSamplingDecisions(t3) {
        var e3, r3, i3, n3 = this.mh;
        if (!mr2(n3)) return null == (r3 = this._instance.persistence) || r3.unregister(Ti2), void (null == (i3 = this._instance.persistence) || i3.unregister(Ii2));
        var s3 = this._instance.get_property(Ti2), a3 = this._instance.get_property(Ii2), o3 = as2(s3, t3), u3 = mr2(a3) && a3 !== n3, l3 = cr2(a3) && s3 === t3, h3 = u3 || l3 || !gr2(o3), d3 = h3 ? Kn2(t3, n3) : o3;
        h3 && (d3 ? this.yh("sampled") : ns2.warn("Sample rate (" + n3 + ") has determined that this sessionId (" + t3 + ") will not be sent to the server.")), null == (e3 = this._instance.persistence) || e3.register({ [Ti2]: ss2(t3, d3), [Ii2]: fr2(a3) && s3 === t3 ? null : n3 });
      }
      ensureSamplingDecision(t3) {
        if (mr2(this.mh)) {
          var e3 = this._instance.get_property(Ti2);
          gr2(as2(e3, t3)) || this.makeSamplingDecisions(t3);
        }
      }
      onFlushComplete() {
      }
      clearConditionalRecordingPersistence() {
        var t3, e3, r3, i3, n3;
        null == (t3 = this._instance.persistence) || t3.unregister(Ei2), null == (e3 = this._instance.persistence) || e3.unregister(Ai2), null == (r3 = this._instance.persistence) || r3.unregister(Ti2), null == (i3 = this._instance.persistence) || i3.unregister(Ii2), null == (n3 = this._instance.persistence) || n3.unregister(Oi2);
      }
      updateActiveTriggers(t3) {
      }
      hasPendingTriggers(t3) {
        var e3;
        return (null == (e3 = this.kh) ? void 0 : e3.triggerStatus(t3)) === Zi2;
      }
      stop() {
        var t3;
        null == (t3 = this._h) || t3.call(this), this._h = void 0, this.ih.stop(), this.rh.stop(), this.nh.stop();
      }
    }
    class us2 {
      constructor(t3, e3, r3, i3, n3) {
        this.Sh = [], this.Ih = /* @__PURE__ */ new Map(), this.Mh = false, this._instance = t3, this.rh = e3, this.yh = r3, this.Ch = i3, this.bh = n3;
      }
      onRemoteConfig(t3) {
        t3.triggerGroups && 0 !== t3.triggerGroups.length ? (this.Rh(t3.triggerGroups), this._instance.register_for_session({ [Bi2]: "v2_trigger_groups", $sdk_debug_replay_trigger_groups_count: t3.triggerGroups.length }), this.rh.onConfig(t3)) : ns2.warn("[V2Strategy] No trigger groups configured");
      }
      getStatus(t3) {
        return function(t4) {
          if (t4.rrwebError) return Hi2;
          if (t4.urlTriggerMatching.urlBlocked) return qi2;
          var e3 = t4.triggerGroupMatchers, r3 = t4.triggerGroupSamplingResults;
          if (0 === e3.length) return $i2;
          var i3 = false, n3 = false;
          for (var s3 of e3) {
            var a3 = s3.triggerStatus(t4.sessionId);
            if (a3 === Vi2) {
              var o3 = s3.group.id, u3 = r3.get(o3);
              cr2(u3) ? Cr2.warn("[V2 Triggers] Group activated but no sampling decision found", { groupId: o3 }) : true === u3 && (n3 = true);
            } else a3 === Zi2 && (i3 = true);
          }
          return n3 ? Ui2 : i3 ? ji2 : $i2;
        }({ isSampled: t3.isSampled, rrwebError: t3.rrwebError, urlTriggerMatching: t3.urlTriggerMatching, eventTriggerMatching: t3.eventTriggerMatching, linkedFlagMatching: t3.linkedFlagMatching, sessionId: t3.sessionId, triggerGroupMatchers: this.Sh, triggerGroupSamplingResults: this.Ih, minimumDuration: this.getMinimumDuration(t3.sessionId) });
      }
      getMinimumDuration(t3) {
        var e3 = null;
        for (var r3 of this.Sh) if ("trigger_activated" === r3.triggerStatus(t3)) {
          var i3 = r3.group.minDurationMs;
          mr2(i3) && (fr2(e3) || e3 > i3) && (e3 = i3);
        }
        return e3;
      }
      checkUrlTriggers(t3, e3, r3, i3) {
        var n3 = this;
        this.rh.checkUrlBlocklist(e3, r3);
        var s3 = function(i4) {
          i4.checkUrlTriggerConditions(e3, r3, (e4) => {
            n3.xh(i4, void 0) && (i4.activateTrigger(e4, t3), n3.updateActiveTriggers(t3), n3.bh());
          }, t3);
        };
        for (var a3 of this.Sh) s3(a3);
      }
      setupEventTriggerListeners(t3, e3, r3) {
        var i3 = this;
        return this._h = t3((t4) => {
          var r4;
          if (this.Mh) return ns2.info("[SessionRecorder] Stopping trigger checks - initial buffer flushed"), null == (r4 = this._h) || r4.call(this), void (this._h = void 0);
          try {
            var n3 = function(r5) {
              r5.checkEventTriggerConditions(t4.event, (n4) => {
                if (i3.xh(r5, t4.properties)) {
                  var s4 = (r5.group.conditions.events || []).filter((e4) => e4.name === t4.event), a3 = i3._instance.get_property(Wi2);
                  s4.some((e4) => !e4.properties || 0 === e4.properties.length || is2(e4.properties, t4.properties, a3)) && (r5.activateTrigger(n4, e3), i3.updateActiveTriggers(e3), i3.bh());
                }
              }, e3);
            };
            for (var s3 of this.Sh) n3(s3);
          } catch (t5) {
            ns2.error("Could not activate event trigger for trigger groups", t5);
          }
        }), this._h;
      }
      makeSamplingDecisions(t3) {
        for (var e3 of this.Sh) {
          var r3, i3 = e3.group, n3 = i3.id, s3 = i3.sampleRate, a3 = Fi2 + n3, o3 = this._instance.get_property(a3), u3 = null, l3 = false, h3 = false, d3 = false;
          if (dr2(o3)) {
            var c3 = o3.sessionId, v3 = o3.sampleRate, f3 = o3.sampled;
            l3 = "string" == typeof c3 && c3 !== t3, h3 = mr2(v3) && v3 !== s3, u3 = c3 === t3 && mr2(v3) && v3 === s3 && gr2(f3) ? f3 : null;
          } else u3 = o3 === t3 || null, l3 = "string" == typeof o3 && o3 !== t3, d3 = o3 === t3;
          var p3 = l3 || h3 || d3 || !gr2(u3), m3 = p3 ? Kn2(t3 + n3, s3) : u3;
          p3 && this.Ch("triggerGroupSamplingDecisionMade", { group_id: n3, group_name: i3.name, sampleRate: s3, isSampled: m3 }), this.Ih.set(n3, m3), null == (r3 = this._instance.persistence) || r3.register({ [a3]: { sessionId: t3, sampleRate: s3, sampled: m3 } });
        }
        this.updateActiveTriggers(t3);
      }
      ensureSamplingDecision(t3) {
      }
      onFlushComplete() {
        this.Mh = true;
      }
      clearConditionalRecordingPersistence() {
        var t3, e3, r3;
        for (var i3 of (null == (t3 = this._instance.persistence) || t3.unregister(Ti2), null == (e3 = this._instance.persistence) || e3.unregister(Ii2), null == (r3 = this._instance.persistence) || r3.unregister(Oi2), this.Sh)) {
          var n3, s3, a3, o3 = i3.group.id;
          null == (n3 = this._instance.persistence) || n3.unregister(Ni2 + o3), null == (s3 = this._instance.persistence) || s3.unregister(Li2 + o3), null == (a3 = this._instance.persistence) || a3.unregister(Fi2 + o3);
        }
      }
      updateActiveTriggers(t3) {
        var e3 = [];
        for (var r3 of this.Sh) {
          var i3 = r3.group, n3 = i3.id, s3 = "trigger_activated" === r3.triggerStatus(t3), a3 = true === this.Ih.get(n3);
          s3 && e3.push({ id: n3, name: i3.name, matched: true, sampled: a3 });
        }
        this._instance.register_for_session({ $sdk_debug_replay_matched_recording_trigger_groups: e3 });
      }
      hasPendingTriggers(t3) {
        for (var e3 of this.Sh) if (e3.triggerStatus(t3) === Zi2) return true;
        return false;
      }
      stop() {
        var t3;
        null == (t3 = this._h) || t3.call(this), this._h = void 0, this.Sh.forEach((t4) => t4.stop()), this.Sh = [], this.Ih.clear(), this.rh.stop();
      }
      xh(t3, e3) {
        var r3 = t3.group.conditions.properties;
        return !r3 || 0 === r3.length || is2(r3, e3, this._instance.get_property(Wi2));
      }
      Rh(t3) {
        var e3 = this;
        this.Sh.forEach((t4) => t4.stop()), this.Sh = [], this.Ih.clear();
        var r3 = function(t4) {
          var r4 = new an2(e3._instance, t4, (r5, i4) => {
            e3.yh("linked_flag_matched", { flag: r5, variant: i4, group_id: t4.id, group_name: t4.name }), e3.bh();
          });
          e3.Sh.push(r4);
        };
        for (var i3 of t3) r3(i3);
      }
    }
    var ls2 = ["gclid", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx"];
    function hs2(t3) {
      return dr2(t3) ? t3.network_timing : t3;
    }
    var ds2, cs2, vs2 = "[SessionRecording]", fs2 = xr2(vs2), ps2 = [_i2.MouseMove, _i2.MouseInteraction, _i2.Scroll, _i2.ViewportResize, _i2.Input, _i2.TouchMove, _i2.MediaInteraction, _i2.Drag], ms2 = (t3) => ({ rrwebMethod: t3, enqueuedAt: Date.now(), attempt: 1 });
    function gs2() {
      var t3;
      return null == er2 || null == (t3 = er2.__PosthogExtensions__) ? void 0 : t3.rrweb;
    }
    function ys2() {
      var t3;
      return null == (t3 = gs2()) ? void 0 : t3.record;
    }
    function ws2(t3) {
      try {
        return JSON.stringify(t3);
      } catch (e3) {
        return JSON.stringify(t3, ln2());
      }
    }
    function bs2(t3) {
      return Zn2(function(t4, e3) {
        void 0 === e3 && (e3 = {});
        var r3 = jn2(), i3 = t4.length;
        r3.p(t4);
        var n3 = qn(t4, e3, Vn2(e3), 8), s3 = n3.length;
        return Gn2(n3, e3), Hn(n3, s3 - 8, r3.d()), Hn(n3, s3 - 4, i3), n3;
      }(function(t4, e3) {
        var r3 = t4.length;
        if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(t4);
        for (var i3 = new vn2(t4.length + (t4.length >>> 1)), n3 = 0, s3 = function(t5) {
          i3[n3++] = t5;
        }, a3 = 0; r3 > a3; ++a3) {
          if (n3 + 5 > i3.length) {
            var o3 = new vn2(n3 + 8 + (r3 - a3 << 1));
            o3.set(i3), i3 = o3;
          }
          var u3 = t4.charCodeAt(a3);
          128 > u3 ? s3(u3) : 2048 > u3 ? (s3(192 | u3 >>> 6), s3(128 | 63 & u3)) : u3 > 55295 && 57344 > u3 ? (s3(240 | (u3 = 65536 + (1047552 & u3) | 1023 & t4.charCodeAt(++a3)) >>> 18), s3(128 | u3 >>> 12 & 63), s3(128 | u3 >>> 6 & 63), s3(128 | 63 & u3)) : (s3(224 | u3 >>> 12), s3(128 | u3 >>> 6 & 63), s3(128 | 63 & u3));
        }
        return En2(i3, 0, n3);
      }(ws2(t3))));
    }
    function ks2(t3) {
      return _s2.apply(this, arguments);
    }
    function _s2() {
      return _s2 = e2(function* (t3) {
        var e3 = ws2(t3), r3 = yield function(t4, e4, r4) {
          return sr2.apply(this, arguments);
        }(e3, Ir2.DEBUG, { rethrow: true });
        return Zn2(new Uint8Array(yield r3.arrayBuffer()));
      }), _s2.apply(this, arguments);
    }
    var Ss2 = "undefined" != typeof globalThis && "CompressionStream" in globalThis && "TextEncoder" in globalThis && "Response" in globalThis && "function" == typeof Response.prototype.blob, Is2 = false;
    function Ms2(t3) {
      return lr2(t3) && 0 === t3.length ? ds2 = null != ds2 ? ds2 : bs2([]) : bs2(t3);
    }
    function Cs2(t3) {
      return xs2.apply(this, arguments);
    }
    function xs2() {
      return (xs2 = e2(function* (t3) {
        return lr2(t3) && 0 === t3.length ? ds2 || (cs2 = null != cs2 ? cs2 : ks2([]).then((t4) => (ds2 = t4, t4)).catch((t4) => {
          throw ds2 = void 0, cs2 = void 0, t4;
        })) : ks2(t3);
      })).apply(this, arguments);
    }
    function Rs2(t3) {
      return Ss2 && !Is2 && function(t4) {
        return t4.type === ki2.FullSnapshot || t4.type === ki2.IncrementalSnapshot && (t4.data.source === _i2.Mutation || t4.data.source === _i2.StyleSheetRule);
      }(t3);
    }
    function Ts2(t3) {
      return { event: t3, size: dn2(t3) };
    }
    function Os2(t3, e3) {
      return r2({}, t3, { data: e3, cv: "2024-10" });
    }
    function As2(t3, e3) {
      return r2({}, t3, { cv: "2024-10", data: r2({}, t3.data, e3) });
    }
    function Es2(t3) {
      try {
        if (t3.type === ki2.FullSnapshot) return Ts2(Os2(t3, bs2(t3.data)));
        if (t3.type === ki2.IncrementalSnapshot && t3.data.source === _i2.Mutation) return Ts2(As2(t3, { texts: Ms2(t3.data.texts), attributes: Ms2(t3.data.attributes), removes: Ms2(t3.data.removes), adds: Ms2(t3.data.adds) }));
        if (t3.type === ki2.IncrementalSnapshot && t3.data.source === _i2.StyleSheetRule) return Ts2(As2(t3, { adds: t3.data.adds ? bs2(t3.data.adds) : void 0, removes: t3.data.removes ? bs2(t3.data.removes) : void 0 }));
      } catch (t4) {
        fs2.error("could not compress event - will use uncompressed event", t4);
      }
      return { event: t3, size: hn2(t3) };
    }
    function Ns2() {
      return (Ns2 = e2(function* (t3) {
        try {
          if (t3.type === ki2.FullSnapshot) return Ts2(Os2(t3, yield ks2(t3.data)));
          if (t3.type === ki2.IncrementalSnapshot && t3.data.source === _i2.Mutation) {
            var e3 = yield Promise.all([Cs2(t3.data.texts), Cs2(t3.data.attributes), Cs2(t3.data.removes), Cs2(t3.data.adds)]);
            return Ts2(As2(t3, { texts: e3[0], attributes: e3[1], removes: e3[2], adds: e3[3] }));
          }
          if (t3.type === ki2.IncrementalSnapshot && t3.data.source === _i2.StyleSheetRule) {
            var r3 = yield Promise.all([t3.data.adds ? ks2(t3.data.adds) : void 0, t3.data.removes ? ks2(t3.data.removes) : void 0]);
            return Ts2(As2(t3, { adds: r3[0], removes: r3[1] }));
          }
        } catch (e4) {
          return ((t4) => {
            if (!t4 || "object" != typeof t4) return false;
            var e5 = "name" in t4 ? String(t4.name) : "";
            return ((t5) => !(!t5 || "object" != typeof t5) && "NotReadableError" === ("name" in t5 ? String(t5.name) : ""))(t4) || e5 === rr2;
          })(e4) && (Is2 = true), fs2.error("could not compress event asynchronously - trying synchronous compression", e4), Es2(t3);
        }
        return { event: t3, size: hn2(t3) };
      })).apply(this, arguments);
    }
    function Ls2(t3, e3) {
      return t3.type === ki2.Custom && t3.data.tag === e3;
    }
    function Fs2(t3) {
      return Ls2(t3, "sessionIdle");
    }
    function Ds2(t3) {
      return Ls2(t3, "$session_ending");
    }
    function Ps2(t3) {
      return Ls2(t3, "$session_starting");
    }
    class Ws2 {
      get sessionId() {
        return this.Mi;
      }
      get Th() {
        if (!this._instance.sessionManager) throw new Error(vs2 + " must be started with a valid sessionManager.");
        return this._instance.sessionManager;
      }
      get Oh() {
        return this._instance.config.session_recording.session_idle_threshold_ms || 3e5;
      }
      get Ah() {
        return as2(this._instance.get_property(Ti2), this.sessionId);
      }
      get mh() {
        var t3, e3 = null == (t3 = this.Ya) ? void 0 : t3.sampleRate;
        return mr2(e3) ? e3 : null;
      }
      get Eh() {
        var t3, e3;
        return null !== (t3 = null == (e3 = this.Nh) ? void 0 : e3.getMinimumDuration(this.sessionId)) && void 0 !== t3 ? t3 : null;
      }
      constructor(t3) {
        this.Lh = "/s/", this._forceAllowLocalhostNetworkCapture = false, this.Fh = void 0, this.Dh = Date.now(), this.Ph = false, this.Wh = [], this.Bh = "unknown", this.$h = false, this.Uh = false, this.zh = false, this.jh = false, this.qh = [], this.Hh = void 0, this.Gh = void 0, this.Vh = [], this.Zh = 0, this.Jh = 0, this.Qh = false, this.Xh = void 0, this._h = void 0, this.Kh = void 0, this.Yh = void 0, this.td = void 0, this.fi = (t4, e4, r4) => {
          var i3, n3, s3;
          if (r4 && (t4 !== this.Mi || e4 !== this.Ti)) {
            var a3, o3 = !r4.noSessionId && (r4.activityTimeout || r4.sessionPastMaximumLength), u3 = this.Mi, l3 = this.Ti;
            o3 && this.Ch("$session_ending", { currentSessionId: u3, currentWindowId: l3, nextSessionId: t4, nextWindowId: e4, changeReason: r4, lastActivityTimestamp: this.Dh, flushed_size: null == (a3 = this.ed) ? void 0 : a3.currentTrackedSize(u3) }), null == (i3 = this._instance.persistence) || i3.unregister(Di2), this.zh = false, null == (n3 = gs2()) || null == n3.resetMaxDepthState || n3.resetMaxDepthState(), this.Ch("$session_id_change", { sessionId: t4, windowId: e4, changeReason: r4 }), this.rd(), false === this.Bh && this.isStarted || this.Mi === t4 && this.Ti === e4 || (this.Bh = "unknown", this.stop(), this.start("session_id_changed")), o3 && this.Ch("$session_starting", { previousSessionId: u3, previousWindowId: l3, nextSessionId: t4, nextWindowId: e4, changeReason: r4, lastActivityTimestamp: this.Dh }), null == (s3 = this.Nh) || s3.makeSamplingDecisions(t4);
          }
        }, this.nd = () => {
          var t4;
          return (null == (t4 = this._instance.persistence) ? void 0 : t4.props[Oi2]) === this.Mi;
        }, this.sd = () => {
          var t4, e4;
          if (0 === this.R.data.length) return null;
          var r4 = null == (t4 = this.R.data[0]) ? void 0 : t4.timestamp, i3 = null == (e4 = this.R.data[this.R.data.length - 1]) ? void 0 : e4.timestamp;
          return mr2(r4) && mr2(i3) ? i3 - r4 : null;
        }, this.ad = () => {
          var t4, e4, r4 = this.Eh;
          if (!mr2(r4)) return false;
          if (null === (t4 = null == (e4 = this._instance.config.session_recording) ? void 0 : e4.strictMinimumDuration) || void 0 === t4 || !t4) {
            var i3 = this.od;
            return mr2(i3) && i3 >= 0 && r4 > i3;
          }
          if (this.nd()) return false;
          var n3, s3 = this.sd();
          return !!fr2(s3) || r4 > s3 || (null == (n3 = this._instance.persistence) || n3.register({ [Oi2]: this.Mi }), false);
        }, this.ud = () => {
          this.status !== ji2 ? (this.ld(), this.hd()) : this.dd();
        }, this.vd = () => {
          this.Ch("browser offline", {});
        }, this.Bs = () => {
          this.Ch("browser online", {});
        }, this.ke = () => {
          null != Xe2 && Xe2.visibilityState && this.Ch("window " + Xe2.visibilityState, {});
        }, this._instance = t3;
        var e3 = this.Th.checkAndGetSessionAndWindowId(), r3 = e3.windowId;
        this.Mi = e3.sessionId, this.Ti = r3, this.nh = new nn2(this._instance), this.rh = new rn2(this._instance), this.ih = new sn2(this._instance), this.R = this.dd(), this.Th.sessionTimeoutMs > this.Oh || fs2.warn("session_idle_threshold_ms (" + this.Oh + ") is greater than the session timeout (" + this.Th.sessionTimeoutMs + "). Session will never be detected as idle"), this.ed = new Xn(this._instance);
      }
      get fd() {
        var t3, e3, r3, i3, n3, s3, a3, o3 = null == (t3 = this.Ya) ? void 0 : t3.masking, u3 = { maskAllInputs: null == (e3 = this._instance.config.session_recording) ? void 0 : e3.maskAllInputs, maskTextSelector: null == (r3 = this._instance.config.session_recording) ? void 0 : r3.maskTextSelector, blockSelector: null == (i3 = this._instance.config.session_recording) ? void 0 : i3.blockSelector }, l3 = null !== (n3 = null == u3 ? void 0 : u3.maskAllInputs) && void 0 !== n3 ? n3 : null == o3 ? void 0 : o3.maskAllInputs, h3 = null !== (s3 = null == u3 ? void 0 : u3.maskTextSelector) && void 0 !== s3 ? s3 : null == o3 ? void 0 : o3.maskTextSelector, d3 = null !== (a3 = null == u3 ? void 0 : u3.blockSelector) && void 0 !== a3 ? a3 : null == o3 ? void 0 : o3.blockSelector;
        return cr2(l3) && cr2(h3) && cr2(d3) ? void 0 : { maskAllInputs: null == l3 || l3, maskTextSelector: h3, blockSelector: d3 };
      }
      pd() {
        var t3;
        if (!this.jh) {
          var e3 = null == (t3 = this.Ya) ? void 0 : t3.masking;
          if (!pr2(e3)) {
            var r3 = this._instance.config.session_recording, i3 = ["maskAllInputs", "maskTextSelector", "blockSelector"].filter((t4) => {
              var i4 = null == r3 ? void 0 : r3[t4], n3 = e3[t4];
              return !cr2(i4) && i4 !== n3;
            });
            0 !== i3.length && (this.jh = true, fs2.warn('Session recording masking is configured both in `posthog.init` and in your project settings, and they differ. The `session_recording` options in `posthog.init` take precedence, so the project ("Privacy and masking") setting is ignored for: ' + i3.join(", ") + ". Remove these masking options from `posthog.init` to use the project setting instead. See https://posthog.com/docs/session-replay/privacy", { client: { maskAllInputs: null == r3 ? void 0 : r3.maskAllInputs, maskTextSelector: null == r3 ? void 0 : r3.maskTextSelector, blockSelector: null == r3 ? void 0 : r3.blockSelector }, project: e3 }));
          }
        }
      }
      get md() {
        var t3;
        return wr2(null == (t3 = this._instance.config.session_recording.canvasCapture) ? void 0 : t3.resolutionScale, 0.1, 1, xr2("canvas recording resolution scale"), 1);
      }
      get gd() {
        var t3, e3, r3, i3, n3, s3, a3, o3 = this._instance.config.session_recording.captureCanvas, u3 = null == (t3 = this.Ya) ? void 0 : t3.canvasRecording, l3 = null !== (e3 = null !== (r3 = null == o3 ? void 0 : o3.recordCanvas) && void 0 !== r3 ? r3 : null == u3 ? void 0 : u3.enabled) && void 0 !== e3 && e3, h3 = null !== (i3 = null !== (n3 = null == o3 ? void 0 : o3.canvasFps) && void 0 !== n3 ? n3 : null == u3 ? void 0 : u3.fps) && void 0 !== i3 ? i3 : 4, d3 = null !== (s3 = null !== (a3 = null == o3 ? void 0 : o3.canvasQuality) && void 0 !== a3 ? a3 : null == u3 ? void 0 : u3.quality) && void 0 !== s3 ? s3 : 0.4;
        if ("string" == typeof d3) {
          var c3 = parseFloat(d3);
          d3 = isNaN(c3) ? 0.4 : c3;
        }
        return { enabled: l3, fps: wr2(h3, 0, 12, xr2("canvas recording fps"), 4), quality: wr2(d3, 0, 1, xr2("canvas recording quality"), 0.4) };
      }
      get yd() {
        var t3, e3 = !(null == (t3 = this.Ya) || !t3.consoleLogRecordingEnabled), r3 = this._instance.config.enable_recording_console_log;
        return null != r3 ? r3 : e3;
      }
      get wd() {
        var t3, e3, r3, i3 = null == (t3 = this.Ya) ? void 0 : t3.networkPayloadCapture, n3 = { recordHeaders: null == (e3 = this._instance.config.session_recording) ? void 0 : e3.recordHeaders, recordBody: null == (r3 = this._instance.config.session_recording) ? void 0 : r3.recordBody }, s3 = (null == n3 ? void 0 : n3.recordHeaders) || (null == i3 ? void 0 : i3.recordHeaders), a3 = (null == n3 ? void 0 : n3.recordBody) || (null == i3 ? void 0 : i3.recordBody), o3 = hs2(this._instance.config.capture_performance), u3 = hs2(null == i3 ? void 0 : i3.capturePerformance), l3 = !!(gr2(o3) ? o3 : u3);
        return s3 || a3 || l3 ? { recordHeaders: s3, recordBody: a3, recordPerformance: l3 } : void 0;
      }
      bd() {
        var t3, e3, i3 = [], n3 = null == (t3 = er2.__PosthogExtensions__) || null == (t3 = t3.rrwebPlugins) ? void 0 : t3.getRecordConsolePlugin;
        n3 && this.yd && i3.push(n3());
        var s3 = null == (e3 = er2.__PosthogExtensions__) || null == (e3 = e3.rrwebPlugins) ? void 0 : e3.getRecordNetworkPlugin;
        return this.wd && hr2(s3) && (!Or2.includes(Ke2.hostname) || this._forceAllowLocalhostNetworkCapture ? i3.push(s3(((t4, e4) => {
          var i4, n4 = { payloadSizeLimitBytes: jr2.payloadSizeLimitBytes, performanceEntryTypeToObserve: [...jr2.performanceEntryTypeToObserve], payloadHostDenyList: [...e4.payloadHostDenyList || [], ...jr2.payloadHostDenyList] }, s4 = false !== t4.session_recording.recordHeaders && e4.recordHeaders, a3 = false !== t4.session_recording.recordBody && e4.recordBody, o3 = false !== t4.capture_performance && e4.recordPerformance, u3 = (i4 = zr2(n4), (t5) => (null != t5 && t5.requestBody && (t5.requestBody = Jr2(t5.requestBody, t5.requestHeaders, i4, "Request")), null != t5 && t5.responseBody && (t5.responseBody = Jr2(t5.responseBody, t5.responseHeaders, i4, "Response")), t5)), l3 = (e5) => {
            return u3(((t5, e6) => {
              var r4, i5 = Ar2(t5.name), n5 = 0 === e6.indexOf("http") ? null == (r4 = Ar2(e6)) ? void 0 : r4.pathname : e6;
              "/" === n5 && (n5 = "");
              var s5 = null == i5 ? void 0 : i5.pathname.replace(n5 || "", "");
              if (!(i5 && s5 && Zr2.some((t6) => 0 === s5.indexOf(t6)))) return t5;
            })((Vr2((r3 = e5).requestHeaders), Vr2(r3.responseHeaders), r3), t4.api_host));
            var r3;
          }, h3 = hr2(t4.session_recording.maskNetworkRequestFn);
          return h3 && hr2(t4.session_recording.maskCapturedNetworkRequestFn) && Cr2.warn("Both `maskNetworkRequestFn` and `maskCapturedNetworkRequestFn` are defined. `maskNetworkRequestFn` will be ignored."), h3 && (t4.session_recording.maskCapturedNetworkRequestFn = (e5) => {
            var i5 = t4.session_recording.maskNetworkRequestFn({ url: e5.name });
            return r2({}, e5, { name: null == i5 ? void 0 : i5.url });
          }), n4.maskRequestFn = hr2(t4.session_recording.maskCapturedNetworkRequestFn) ? (e5) => {
            var r3, i5 = l3(e5);
            return i5 && null !== (r3 = null == t4.session_recording.maskCapturedNetworkRequestFn ? void 0 : t4.session_recording.maskCapturedNetworkRequestFn(i5)) && void 0 !== r3 ? r3 : void 0;
          } : (t5) => function(t6) {
            if (!cr2(t6)) return t6.requestBody = Qr2(t6.requestBody, "Request"), t6.responseBody = Qr2(t6.responseBody, "Response"), t6;
          }(l3(t5)), r2({}, jr2, n4, { recordHeaders: s4, recordBody: a3, recordPerformance: o3, recordInitialRequests: o3, streamNetworkBody: true === t4.session_recording.streamNetworkBody });
        })(this._instance.config, this.wd))) : fs2.info("NetworkCapture not started because we are on localhost.")), i3;
      }
      kd(t3) {
        return this._instance.config.disable_capture_url_hashes ? kr2(t3) : t3;
      }
      _d(t3, e3) {
        void 0 === e3 && (e3 = false);
        var r3 = e3 ? kr2(t3) : this.kd(t3), i3 = this._instance.config.mask_personal_data_properties ? [...ls2, ...this._instance.config.custom_personal_data_properties || []] : [];
        return this.Sd(function(t4, e4, r4) {
          if (!t4 || !e4 || !e4.length) return t4;
          for (var i4 = t4.split("#"), n3 = i4[1], s3 = (i4[0] || "").split("?"), a3 = s3[1], o3 = s3[0], u3 = (a3 || "").split("&"), l3 = [], h3 = 0; u3.length > h3; h3++) {
            var d3 = u3[h3].split("=");
            lr2(d3) && (e4.includes(d3[0]) ? l3.push(d3[0] + "=<masked>") : l3.push(u3[h3]));
          }
          var c3 = o3;
          return null != a3 && (c3 += "?" + l3.join("&")), null != n3 && (c3 += "#" + n3), c3;
        }(r3, i3));
      }
      Sd(t3) {
        var e3 = this._instance.config.session_recording;
        if (e3.maskCapturedNetworkRequestFn) {
          var r3, i3 = e3.maskCapturedNetworkRequestFn({ name: t3 });
          return null !== (r3 = null == i3 ? void 0 : i3.name) && void 0 !== r3 ? r3 : null == i3 ? void 0 : i3.url;
        }
        if (e3.maskNetworkRequestFn) {
          var n3 = e3.maskNetworkRequestFn({ url: t3 });
          return null == n3 ? void 0 : n3.url;
        }
        return t3;
      }
      Id(t3) {
        try {
          return t3.rrwebMethod(), true;
        } catch (e3) {
          return 10 > this.Wh.length ? this.Wh.push({ enqueuedAt: t3.enqueuedAt || Date.now(), attempt: t3.attempt + 1, rrwebMethod: t3.rrwebMethod }) : fs2.warn("could not emit queued rrweb event.", e3, t3), false;
        }
      }
      Ch(t3, e3) {
        return this.Id(ms2(() => ys2().addCustomEvent(t3, e3)));
      }
      Md() {
        try {
          if (this._instance.config.capture_pageview || !Je2) return;
          var t3 = new URL(Je2.location.href), e3 = this._d(t3.origin + t3.pathname + t3.search);
          this.Cd !== e3 && (this.Cd = e3, this.Ch("$url_changed", { href: e3 }));
        } catch (t4) {
        }
      }
      Rd() {
        if (this.Wh.length) {
          var t3 = [...this.Wh];
          this.Wh = [], t3.forEach((t4) => {
            Date.now() - t4.enqueuedAt > 2e3 || this.Id(t4);
          });
        }
      }
      wh() {
        return this.Id(ms2(() => ys2().takeFullSnapshot()));
      }
      get xd() {
        var t3, e3, r3;
        if (null != (t3 = this.Nh) && t3.hasPendingTriggers(this.sessionId) && !["sampled", "active"].includes(this.status)) {
          var i3, n3 = null == (i3 = this._instance.config.session_recording) ? void 0 : i3.trigger_pending_buffer_interval_millis;
          return mr2(n3) && Number.isFinite(n3) && n3 >= 1e3 && 36e5 >= n3 ? n3 : 6e4;
        }
        return null !== (e3 = null == (r3 = this._instance.config.session_recording) ? void 0 : r3.full_snapshot_interval_millis) && void 0 !== e3 ? e3 : 3e5;
      }
      Td() {
        if (this.Od && clearInterval(this.Od), true !== this.Bh) {
          var t3 = this.xd;
          t3 && (this.Od = setInterval(() => {
            this.wh();
          }, t3));
        }
      }
      bh() {
        !this.rh.urlBlocked && ["sampled", "active"].includes(this.status) && this.Td();
      }
      Ad() {
        this.rh.urlBlocked || (this.rh.urlBlocked = true, clearInterval(this.Od), fs2.info("recording paused due to URL blocker"), this.Ch("recording paused", { reason: "url blocker" }));
      }
      Ed() {
        this.rh.urlBlocked && (this.rh.urlBlocked = false, this.wh(), this.Td(), this.Ch("recording resumed", { reason: "left blocked url" }), fs2.info("recording resumed"));
      }
      Nd(t3, e3) {
        var r3;
        if (!this.Ph && null != (r3 = this.Nh) && r3.hasPendingTriggers(this.sessionId)) {
          this.Ph = true;
          try {
            var i3, n3;
            null == (i3 = this._instance.persistence) || i3.register({ ["url" === t3 ? Ai2 : Ei2]: this.sessionId }), null == (n3 = this.Nh) || n3.updateActiveTriggers(this.sessionId), this.bh(), this.hd(), this.yh(t3 + "_trigger_matched", { ["url" === t3 ? "matchedUrl" : "matchedEvent"]: e3 });
          } finally {
            this.Ph = false;
          }
        }
      }
      get isStarted() {
        return !!this.Fh;
      }
      get Ya() {
        var t3 = this._instance.get_property(Si2);
        if (t3) {
          var e3;
          try {
            e3 = dr2(t3) ? t3 : JSON.parse(t3);
          } catch (t4) {
            return void fs2.warn("persisted remote config for session recording is invalid and will be ignored", t4);
          }
          if (!this.isStarted) {
            var r3, i3, n3 = null !== (r3 = e3.cache_timestamp) && void 0 !== r3 ? r3 : Date.now();
            if (Date.now() - n3 > 36e5) return fs2.info("persisted remote config for session recording is stale and will be ignored", { cacheTimestamp: n3, persistedConfig: t3 }), void (null == (i3 = this._instance.persistence) || i3.unregister(Si2));
          }
          return e3;
        }
      }
      Ld(t3, e3, r3) {
        this._instance.get_property(t3) && (e3(), r3());
      }
      start(t3) {
        var e3, r3, i3 = this.Ya;
        if (i3) {
          this.Qh && (this.Fd(), this.dd());
          var n3 = this.Th.checkAndGetSessionAndWindowId(), s3 = n3.windowId;
          this.Mi = n3.sessionId, this.Ti = s3, null == (e3 = this._instance.persistence) || e3.unregister(Di2), null != i3 && i3.endpoint && (this.Lh = null == i3 ? void 0 : i3.endpoint), this.Nh = 2 === (null == i3 ? void 0 : i3.version) && (null == i3 ? void 0 : i3.triggerGroups) && i3.triggerGroups.length > 0 ? new us2(this._instance, this.rh, this.yh.bind(this), this.Ch.bind(this), this.bh.bind(this)) : new os2(this._instance, this.rh, this.ih, this.nh, this.yh.bind(this), this.wh.bind(this), this.bh.bind(this)), this.Nh.onRemoteConfig(i3), null == (r3 = this._h) || r3.call(this), this._h = this.Nh.setupEventTriggerListeners(this._instance.on.bind(this._instance, "eventCaptured"), this.sessionId, (t4, e4) => this.Nd(t4, e4)), this.Ld(Mi2, () => {
            this.overrideSampling();
          }, () => {
            var t4;
            return null == (t4 = this._instance.persistence) ? void 0 : t4.unregister(Mi2);
          }), this.Ld(Ci2, () => {
            this.overrideLinkedFlag();
          }, () => {
            var t4;
            return null == (t4 = this._instance.persistence) ? void 0 : t4.unregister(Ci2);
          }), this.Ld(Ri2, () => {
            this.overrideTrigger("event");
          }, () => {
            var t4;
            return null == (t4 = this._instance.persistence) ? void 0 : t4.unregister(Ri2);
          }), this.Ld(xi2, () => {
            this.overrideTrigger("url");
          }, () => {
            var t4;
            return null == (t4 = this._instance.persistence) ? void 0 : t4.unregister(xi2);
          }), this.Nh.makeSamplingDecisions(this.sessionId), this.Dd(), this.$h || (Tr2(Je2, "beforeunload", this.ud), Tr2(Je2, "offline", this.vd), Tr2(Je2, "online", this.Bs), Tr2(Je2, "visibilitychange", this.ke), !this.Kh && hr2(this.Th.onSessionId) && (this.Kh = this.Th.onSessionId(this.fi)), !this.Yh && hr2(this.Th.on) ? this.Yh = this.Th.on("forcedIdleReset", () => {
            this.rd(), this.Bh = "unknown", this.stop(), this.td = this.Th.onSessionId((t4, e4, r4) => {
              var i4;
              null == (i4 = this.td) || i4.call(this), this.td = void 0, this.fi(t4, e4, r4);
            });
          }) : hr2(this.Th.on) || fs2.warn("bundled core has no SessionIdManager.on (requires posthog-js >= 1.268.6); recording will start but skip forced-idle-reset handling"), pr2(this.Xh) && (this.Xh = this._instance.on("eventCaptured", (t4) => {
            try {
              if ("$pageview" === t4.event) {
                var e4 = null != t4 && t4.properties.$current_url ? this._d(t4.properties.$current_url) : "";
                if (!e4) return;
                this.Ch("$pageview", { href: e4 });
              }
            } catch (t5) {
              fs2.error("Could not add $pageview to rrweb session", t5);
            }
          })), this.status === zi2 && this.yh(t3 || "recording_initialized"));
        } else fs2.info("remote config must be stored in persistence before recording can start");
      }
      Pd() {
        var t3, e3, r3, i3, n3, s3;
        null == Je2 || Je2.removeEventListener("beforeunload", this.ud), null == Je2 || Je2.removeEventListener("offline", this.vd), null == Je2 || Je2.removeEventListener("online", this.Bs), null == Je2 || Je2.removeEventListener("visibilitychange", this.ke), clearInterval(this.Od), this.Wd(), null == (t3 = this.Xh) || t3.call(this), this.Xh = void 0, null == (e3 = this._h) || e3.call(this), this._h = void 0, null == (r3 = this.Kh) || r3.call(this), this.Kh = void 0, null == (i3 = this.Yh) || i3.call(this), this.Yh = void 0, null == (n3 = this.td) || n3.call(this), this.td = void 0, null == (s3 = this.Nh) || s3.stop(), this.Bd(), this.Fd();
      }
      Fd() {
        this.Jh += 1, this.Vh = [], this.Zh = 0, this.$d = void 0, this.Qh = false;
      }
      Bd() {
        var t3, e3;
        null == (t3 = this.Ud) || t3.stop(), this.Wh = [], null == (e3 = this.Fh) || e3.call(this), this.Fh = void 0;
      }
      zd() {
        if (!this.$d || 0 === this.Zh) return false;
        if (this.Qh) return true;
        this.Qh = true;
        var t3 = this.Jh;
        return this.Wd(), this.Bd(), this.$d.catch(() => {
        }).then(() => {
          t3 === this.Jh && (this.Qh = false, this.hd(), this.dd(), this.Pd(), fs2.info("stopped"));
        }).catch(() => {
          this.Qh = false, this.Pd(), fs2.info("stopped");
        }), true;
      }
      stop() {
        this.zd() || (this.hd(), this.dd(), this.Pd(), fs2.info("stopped"));
      }
      discard() {
        this.dd(), this.Pd(), fs2.info("discarded");
      }
      jd(t3, e3, r3, i3, n3) {
        var s3, a3 = { $snapshot_bytes: r3, $snapshot_data: e3, $session_id: i3, $window_id: n3 };
        t3.type === ki2.FullSnapshot && null != (s3 = gs2()) && null != s3.wasMaxDepthReached && s3.wasMaxDepthReached() && (this.zh = true), this.status !== $i2 ? (this.qd(t3, i3), this.Hd(a3)) : this.dd();
      }
      qd(t3, e3) {
        t3.type !== ki2.FullSnapshot ? t3.type === ki2.IncrementalSnapshot && (cr2(this.Hh) || this.Hh === e3 || this.Gh === e3 || (this.Gh = e3, fs2.info("incremental snapshot for a session with no full snapshot - requesting one", { sessionId: e3 }), this.wh())) : this.Hh = e3;
      }
      Gd(t3) {
        t3.counted && t3.generation === this.Jh && (this.Zh = Math.max(0, this.Zh - 1)), t3.counted = false, this.Vh = this.Vh.filter((e3) => e3 !== t3);
      }
      Vd(t3, e3, r3) {
        t3.processed || t3.generation !== this.Jh || (t3.processed = true, this.jd(t3.event, e3, r3, t3.targetSessionId, t3.targetWindowId));
      }
      Zd(t3) {
        try {
          var e3 = t3.compressionEnabled ? Es2(t3.event) : { event: t3.event, size: hn2(t3.event) };
          this.Vd(t3, e3.event, e3.size);
        } finally {
          this.Gd(t3);
        }
      }
      ld() {
        [...this.Vh].forEach((t3) => {
          this.Zd(t3);
        });
      }
      Jd(t3, r3, i3, n3) {
        var s3 = this, a3 = { event: t3, compressionEnabled: r3, targetSessionId: i3, targetWindowId: n3, generation: this.Jh, processed: false, counted: true };
        this.Vh.push(a3), this.Zh += 1;
        var o3 = function() {
          var i4 = e2(function* () {
            try {
              if (a3.processed) return;
              var e3, i5;
              try {
                var n4 = r3 ? Rs2(t3) ? yield function(t4) {
                  return Ns2.apply(this, arguments);
                }(t3) : Es2(t3) : { event: t3, size: hn2(t3) };
                e3 = n4.event, i5 = n4.size;
              } catch (r4) {
                fs2.error("could not process queued compression event - will use uncompressed event", r4), e3 = t3, i5 = hn2(t3);
              }
              s3.Vd(a3, e3, i5);
            } finally {
              s3.Gd(a3);
            }
          });
          return function() {
            return i4.apply(this, arguments);
          };
        }();
        this.$d = this.$d ? this.$d.catch(() => {
        }).then(o3) : o3();
      }
      onRRwebEmit(t3) {
        var e3, r3, i3, n3, s3, a3, o3;
        if (this._instance.sessionManager && (this.Rd(), t3 && dr2(t3))) {
          if (t3.type === ki2.Meta) {
            var u3 = this._d(t3.data.href);
            if (this.Cd = u3, !u3) return;
            t3.data.href = u3;
          } else this.Md();
          if (null == (e3 = this.Nh) || e3.checkUrlTriggers(this.sessionId, () => this.Ad(), () => this.Ed(), (t4, e4) => this.Nd(t4, e4)), !this.rh.urlBlocked || (l3 = t3).type === ki2.Custom && "recording paused" === l3.data.tag) {
            var l3, h3, d3;
            t3.type === ki2.FullSnapshot && (this.Td(), null == (h3 = this.Ud) || h3.reset(), null == (d3 = this._instance.persistence) || d3.register_once({ [Di2]: t3.timestamp }, void 0)), t3.type === ki2.FullSnapshot && null != (r3 = this.Nh) && r3.hasPendingTriggers(this.sessionId) && this.Qd();
            var c3 = this.Ud ? this.Ud.throttleMutations(t3) : t3;
            if (c3) {
              var v3 = function(t4) {
                var e4 = t4;
                if (e4 && dr2(e4) && 6 === e4.type && dr2(e4.data) && "rrweb/console@1" === e4.data.plugin) {
                  e4.data.payload.payload.length > 10 && (e4.data.payload.payload = e4.data.payload.payload.slice(0, 10), e4.data.payload.payload.push("...[truncated]"));
                  for (var r4 = [], i4 = 0; e4.data.payload.payload.length > i4; i4++) r4.push(e4.data.payload.payload[i4] && e4.data.payload.payload[i4].length > 2e3 ? e4.data.payload.payload[i4].slice(0, 2e3) + "...[truncated]" : e4.data.payload.payload[i4]);
                  return e4.data.payload.payload = r4, t4;
                }
                return t4;
              }(c3), f3 = function(t4) {
                return Ds2(t4) ? t4.data.payload : null;
              }(v3), p3 = function(t4) {
                return Ps2(t4) ? t4.data.payload : null;
              }(v3);
              if (f3 || p3) {
                var m3 = null != f3 ? f3 : p3;
                null != m3 && m3.lastActivityTimestamp && (v3.timestamp = m3.lastActivityTimestamp);
              } else this.Xd(v3);
              t3.type === ki2.FullSnapshot && (this.qh.push([this.Mi, t3.timestamp]), this.qh.length > 6 && (this.qh = this.qh.slice(-6)));
              var g3 = null !== (i3 = null !== (n3 = null == f3 ? void 0 : f3.currentSessionId) && void 0 !== n3 ? n3 : null == p3 ? void 0 : p3.nextSessionId) && void 0 !== i3 ? i3 : this.Mi, y3 = null !== (s3 = null !== (a3 = null == f3 ? void 0 : f3.currentWindowId) && void 0 !== a3 ? a3 : null == p3 ? void 0 : p3.nextWindowId) && void 0 !== s3 ? s3 : this.Ti;
              if (true !== this.Bh || function(t4) {
                return Fs2(t4) || Ds2(t4) || Ps2(t4);
              }(v3)) {
                if (Fs2(v3)) {
                  var w3 = v3.data.payload;
                  w3 && (v3.timestamp = w3.lastActivityTimestamp + w3.threshold);
                }
                var b3 = null === (o3 = this._instance.config.session_recording.compress_events) || void 0 === o3 || o3;
                if (this.Zh > 0 || b3 && Rs2(v3)) this.Jd(v3, b3, g3, y3);
                else {
                  var k3 = b3 ? Es2(v3) : { event: v3, size: hn2(v3) };
                  this.jd(v3, k3.event, k3.size, g3, y3);
                }
              }
            }
          }
        }
      }
      get status() {
        return this.Nh ? this.Nh.getStatus({ instance: this._instance, sessionId: this.sessionId, isSampled: this.Ah, rrwebError: this.$h, urlTriggerMatching: this.rh, eventTriggerMatching: this.ih, linkedFlagMatching: this.nh, remoteConfig: this.Ya }) : $i2;
      }
      log(t3, e3) {
        var r3;
        void 0 === e3 && (e3 = "log"), null == (r3 = this._instance.sessionRecording) || r3.onRRwebEmit({ type: 6, data: { plugin: "rrweb/console@1", payload: { level: e3, trace: [], payload: [JSON.stringify(t3)] } }, timestamp: Date.now() });
      }
      overrideLinkedFlag() {
        this.nh.linkedFlagSeen = true, this.wh(), this.yh("linked_flag_overridden");
      }
      overrideSampling() {
        var t3;
        null == (t3 = this._instance.persistence) || t3.register({ [Ti2]: this.sessionId, [Ii2]: null }), this.wh(), this.yh("sampling_overridden");
      }
      overrideTrigger(t3) {
        this.Nd(t3);
      }
      Kd() {
        try {
          var t3, e3 = null == Je2 || null == (t3 = Je2.location) ? void 0 : t3.href;
          if (!e3) return;
          var r3 = this._d(e3);
          if (!r3) return;
          return new URL(r3).hostname || void 0;
        } catch (t4) {
          return;
        }
      }
      Wd() {
        this.Yd && (clearTimeout(this.Yd), this.Yd = void 0);
      }
      hd() {
        var t3;
        this.Wd(), null == (t3 = this.Nh) || t3.ensureSamplingDecision(this.sessionId);
        var e3 = this.ad();
        if (this.status === ji2 || this.status === qi2 || this.status === $i2 || e3) return this.Yd = setTimeout(() => {
          this.hd();
        }, 2e3), this.R;
        if (this.R.data.length > 0) {
          var r3, i3 = this.Kd();
          cn2(this.R).forEach((t4) => {
            var e4;
            null == (e4 = this.ed) || e4.trackSize(t4.sessionId, t4.size), this.tc({ $snapshot_bytes: t4.size, $snapshot_data: t4.data, $session_id: t4.sessionId, $window_id: t4.windowId, $lib: Ir2.LIB_NAME, $lib_version: Ir2.LIB_VERSION, $snapshot_host: i3 });
          }), null == (r3 = this.Nh) || r3.onFlushComplete();
        }
        return this.dd();
      }
      Hd(t3) {
        var e3, r3 = 2 + ((null == (e3 = this.R) ? void 0 : e3.data.length) || 0), i3 = t3.$session_id, n3 = this.R.sessionId !== i3;
        (n3 || true !== this.Bh && this.R.size + t3.$snapshot_bytes + r3 > 943718.4) && (this.R = this.hd(), n3 && this.R.data.length > 0 && (this.R = this.dd()), this.R.sessionId = i3, this.R.windowId = t3.$window_id), this.R.size += t3.$snapshot_bytes, this.R.data.push(t3.$snapshot_data), this.R.sizes.push(t3.$snapshot_bytes), this.Yd || true === this.Bh || (this.Yd = setTimeout(() => {
          this.hd();
        }, 2e3));
      }
      tc(t3) {
        this._instance.capture("$snapshot", t3, { _url: this._instance.requestRouter.endpointFor("api", this.Lh), _noTruncate: true, _batchKey: "recordings", skip_client_rate_limiting: true });
      }
      get od() {
        var t3, e3, r3 = null == (t3 = this.R) ? void 0 : t3.data[(null == (e3 = this.R) ? void 0 : e3.data.length) - 1], i3 = this.Th.checkAndGetSessionAndWindowId(true);
        return r3 ? r3.timestamp - i3.sessionStartTimestamp : null;
      }
      Qd() {
        if (!this.R || 0 === this.R.data.length) return this.dd();
        for (var t3 = -1, e3 = this.R.data.length - 1; e3 >= 0; e3--) if (this.R.data[e3].type === ki2.Meta) {
          t3 = e3;
          break;
        }
        return 0 > t3 ? this.dd() : (this.R.data = this.R.data.slice(t3), this.R.sizes = this.R.sizes.slice(t3), this.R.size = this.R.sizes.reduce((t4, e4) => t4 + e4, 0), this.R);
      }
      dd() {
        return this.R = { size: 0, data: [], sizes: [], sessionId: this.Mi, windowId: this.Ti }, this.R;
      }
      yh(t3, e3) {
        this._instance.register_for_session({ $session_recording_start_reason: t3 }), fs2.info(t3.replace("_", " "), e3), "session_id_changed" !== t3 && this.Ch("$recording_started", r2({ reason: t3 }, e3));
      }
      ec(t3) {
        var e3;
        return 3 === t3.type && -1 !== ps2.indexOf(null == (e3 = t3.data) ? void 0 : e3.source);
      }
      Xd(t3) {
        var e3 = this.ec(t3);
        e3 || this.Bh || t3.timestamp - this.Dh > this.Oh && (this.Bh = true, clearInterval(this.Od), this.Ch("sessionIdle", { eventTimestamp: t3.timestamp, lastActivityTimestamp: this.Dh, threshold: this.Oh, bufferLength: this.R.data.length, bufferSize: this.R.size }), this.hd());
        var r3 = false;
        if (e3 && (this.Dh = t3.timestamp, this.Bh)) {
          var i3 = "unknown" === this.Bh;
          this.Bh = false, i3 || (this.Ch("sessionNoLongerIdle", { reason: "user activity", type: t3.type }), r3 = true);
        }
        if (true !== this.Bh) {
          var n3 = this.Th.checkAndGetSessionAndWindowId(!e3, t3.timestamp), s3 = n3.windowId, a3 = n3.sessionId, o3 = this.Mi !== a3, u3 = this.Ti !== s3;
          this.Ti = s3, this.Mi = a3, o3 || u3 ? (this.stop(), this.start("session_id_changed")) : r3 && this.Td();
        }
      }
      rd() {
        var t3;
        null == (t3 = this.Nh) || t3.clearConditionalRecordingPersistence();
      }
      get sdkDebugProperties() {
        var t3, e3 = this.Th.checkAndGetSessionAndWindowId(true);
        return { $recording_status: this.status, $sdk_debug_replay_internal_buffer_length: this.R.data.length, $sdk_debug_replay_internal_buffer_size: this.R.size, $sdk_debug_current_session_duration: this.od, $sdk_debug_session_start: e3.sessionStartTimestamp, $sdk_debug_replay_flushed_size: null == (t3 = this.ed) ? void 0 : t3.currentTrackedSize(this.sessionId), $sdk_debug_replay_full_snapshots: this.qh, $snapshot_max_depth_exceeded: this.zh, $sdk_debug_replay_rrweb_error: this.$h, $sdk_debug_rrweb_attached: !!this.Fh, $sdk_debug_rrweb_start_attempted: this.Uh };
      }
      Dd() {
        var t3;
        if (!this.Fh) {
          this.Uh = true;
          var e3, i3, n3, s3 = { blockClass: "ph-no-capture", blockSelector: void 0, ignoreClass: "ph-ignore-input", maskTextClass: "ph-mask", maskTextSelector: void 0, maskTextFn: void 0, maskAllInputs: true, maskInputOptions: { password: true }, maskInputFn: void 0, slimDOMOptions: {}, collectFonts: false, inlineStylesheet: true, recordCrossOriginIframes: false, attributeFilter: void 0 }, a3 = this._instance.config.session_recording;
          for (var o3 of Object.entries(a3 || {})) {
            var u3 = o3[0], l3 = o3[1];
            u3 in s3 && ("maskInputOptions" === u3 ? s3.maskInputOptions = r2({ password: true }, l3) : s3[u3] = l3);
          }
          this.gd && this.gd.enabled && (s3.recordCanvas = true, s3.sampling = { canvas: this.gd.fps }, s3.dataURLOptions = { type: "image/webp", quality: this.gd.quality }, s3.canvasResolutionScale = this.md), this.fd && (s3.maskAllInputs = null === (e3 = this.fd.maskAllInputs) || void 0 === e3 || e3, s3.maskTextSelector = null !== (i3 = this.fd.maskTextSelector) && void 0 !== i3 ? i3 : void 0, s3.blockSelector = null !== (n3 = this.fd.blockSelector) && void 0 !== n3 ? n3 : void 0), this.pd();
          var h3 = ys2();
          if (h3) {
            this.Ud = null !== (t3 = this.Ud) && void 0 !== t3 ? t3 : new Jn2(h3, { refillRate: this._instance.config.session_recording.__mutationThrottlerRefillRate, bucketSize: this._instance.config.session_recording.__mutationThrottlerBucketSize, onBlockedNode: (t4, e4) => {
              var r3 = "Too many mutations on node '" + t4 + "'. Rate limiting. This could be due to SVG animations or something similar";
              fs2.info(r3, { node: e4 }), this.log(vs2 + " " + r3, "warn");
            } });
            var d3 = this.bd();
            if (this.Fh = h3(r2({ emit: (t4) => {
              this.onRRwebEmit(t4);
            }, plugins: d3 }, s3)), !this.Fh) return this.$h = true, void fs2.error("rrweb failed to start - Loss of recording data is possible. Check the browser console for rrweb errors.");
            this.$h = false, this.Dh = Date.now(), this.Bh = gr2(this.Bh) ? this.Bh : "unknown", this.tryAddCustomEvent("$remote_config_received", this.Ya), this.Ch("$session_options", { sessionRecordingOptions: s3, activePlugins: d3.map((t4) => null == t4 ? void 0 : t4.name) }), this.Ch("$posthog_config", { config: this._instance.config });
          } else fs2.error("_startRecorder was called but rrwebRecord is not available. This indicates something has gone wrong.");
        }
      }
      tryAddCustomEvent(t3, e3) {
        return this.Ch(t3, e3);
      }
    }
    er2.__PosthogExtensions__ = er2.__PosthogExtensions__ || {}, er2.__PosthogExtensions__.rrwebPlugins = { getRecordConsolePlugin: (t3) => ({ name: "rrweb/console@1", observer: Ze2, options: t3 }), getRecordNetworkPlugin: (t3) => ({ name: "rrweb/network@1", observer: bi2, options: t3 }) }, er2.__PosthogExtensions__.rrweb = { record: Le2, version: "v2", wasMaxDepthReached: () => dt2, resetMaxDepthState() {
      dt2 = false, ht2 = false;
    } }, er2.__PosthogExtensions__.initSessionRecording = (t3) => new Ws2(t3);
  }();

  // src/analytics.js
  var PROJECT_TOKEN = "phc_uGU456NXKhzPnNpdMsiPpDZrXY2ydg67rP2ixQT6QEkE";
  var API_HOST = "https://us.i.posthog.com";
  var HOST_PAGE_SELECTOR = [
    "body > *:not(#tailorcv-sidebar):not(#tailorcv-launcher):not(#tailorcv-changes-modal)",
    "head > *:not(#tailorcv-styles)"
  ].join(", ");
  var MASKED_TEXT_SELECTOR = "#tcvAccountEmail, #tcvManualJd, #tailorcv-changes-modal";
  var URL_PROP = /(url|referrer|href)$/i;
  function stripUrl(value) {
    if (typeof value !== "string" || !/^https?:/i.test(value)) return value;
    try {
      const u2 = new URL(value);
      return u2.origin + u2.pathname;
    } catch (_2) {
      return value;
    }
  }
  function scrubSnapshot(node, depth) {
    if (depth > 60 || !node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      const v2 = node[key];
      if (typeof v2 === "string") {
        if (v2.startsWith(location.origin) && /[?#]/.test(v2)) node[key] = stripUrl(v2);
      } else if (v2 && typeof v2 === "object") {
        scrubSnapshot(v2, depth + 1);
      }
    }
  }
  function minimizeUrls(event) {
    if (!event || !event.properties) return event;
    const props = event.properties;
    for (const key of Object.keys(props)) {
      if (URL_PROP.test(key)) props[key] = stripUrl(props[key]);
    }
    if (Array.isArray(props.$snapshot_data)) scrubSnapshot(props.$snapshot_data, 0);
    return event;
  }
  var posthog = new Ba();
  function sendRuntimeMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res || {});
        });
      } catch (_2) {
        resolve({});
      }
    });
  }
  var ready = null;
  function init() {
    if (ready) return ready;
    ready = sendRuntimeMessage({ type: "GET_ANALYTICS_ID" }).then((res) => {
      const bootstrap = { distinctID: res.id || crypto.randomUUID() };
      if (res.sessionId) bootstrap.sessionID = res.sessionId;
      posthog.init(PROJECT_TOKEN, {
        api_host: API_HOST,
        bootstrap,
        persistence: "memory",
        disable_external_dependency_loading: true,
        // Host-page behaviour is none of our business: no automatic capture of
        // the job board's clicks, pageviews, errors, performance or console.
        autocapture: false,
        rageclick: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_performance: false,
        capture_exceptions: false,
        enable_recording_console_log: false,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        // sendBeacon from a content script is subject to the HOST PAGE's CSP
        // connect-src, unlike fetch/XHR which run in the extension's own network
        // context — force fetch/XHR so a strict job-board CSP can't silently
        // drop events/recordings on tab close.
        opt_out_useBeacon: true,
        session_recording: {
          blockSelector: HOST_PAGE_SELECTOR,
          maskAllInputs: true,
          maskTextSelector: MASKED_TEXT_SELECTOR,
          recordCrossOriginIframes: false,
          recordHeaders: false,
          recordBody: false,
          captureCanvas: { recordCanvas: false },
          // Keep rrweb events readable by before_send (see scrubSnapshot); the
          // request body is still gzip-compressed on the wire.
          compress_events: false
        },
        before_send: minimizeUrls
      });
      posthog.register({
        source: "chrome_extension",
        ext_version: chrome.runtime.getManifest().version,
        host: location.hostname
      });
    });
    return ready;
  }
  var lastTouch = 0;
  function touchSession() {
    const now = Date.now();
    if (now - lastTouch < 6e4) return;
    lastTouch = now;
    sendRuntimeMessage({ type: "TOUCH_ANALYTICS_SESSION", sessionId: posthog.get_session_id() });
  }
  window.__tcvTrack = function(event, props) {
    init().then(() => {
      posthog.capture(event, props || {});
      touchSession();
    });
  };
  window.__tcvIdentify = function(email) {
    if (!email) return;
    init().then(() => {
      if (posthog.get_distinct_id() !== email) posthog.identify(email, { email });
    });
  };
  init();
})();
