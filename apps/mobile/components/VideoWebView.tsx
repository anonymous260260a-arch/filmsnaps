import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Animated,
  Image,
  Platform,
  Modal,
  ScrollView,
} from 'react-native';
import PlayerWebView, { PlayerWebViewRef } from '../modules/player-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getEnabledProviders, getImageUrl } from '@filmsnaps/shared';
import type { ProviderDefinition } from '@filmsnaps/shared';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useKeepAwake } from 'expo-keep-awake';
import { saveProgress, getResumePoint, getProgress, markCompleted } from '../lib/watchHistory';
import { clearAllState } from '../modules/player-webview';
import { providerConfigs, generateProviderSnippet } from './providerConfig';
import { PlayerControlOverlay } from './player/PlayerControlOverlay';
import { EpisodeRail } from './player/EpisodeRail';
import { ServerPickerSheet } from './player/ServerPickerSheet';

// â”€â”€ Guard scripts â€” injected at document start â”€â”€
const POPUP_BLOCKER_SCRIPT = `(function() {
  var _origOpen=window.open;
  window.open=function(url,name,features){
    if(url&&typeof url==='string'){
      try{
        var u=new URL(url,location.href);
        if(u.hostname!==location.hostname){
          var l=u.href.toLowerCase();
          var AD_PATTERNS=['doubleclick.net','googleadservices.com','googlesyndication.com','google-analytics.com','googletagmanager.com','gtag/js','pagead2.googlesyndication.com','adnxs.com','rubiconproject.com','criteo.com','criteo.net','outbrain.com','taboola.com','revcontent.com','adsystem.','adserver.','ads.','popads.','popcash.','popunder.','adsterra.com','propellerads.com','trafficfactory.biz','pixel.','track.','tracking.','beacon.','histats.com','statcounter.com','scorecardresearch.com','amazon-adsystem.com','casalemedia.com','contextweb.com','openx.net','pubmatic.com','sharethrough.com','media.net','advertising.com','adap.tv','moatads.com','servedby.','exdynsrv.com','exoclick.com','juicyads.com','plugrush.com','trafficjunky.com','adreactor.com','adcash.com','adhitz.com','adk2.com','adpierce.com','clickadu.com','clicksco.net','hilltopads.com','interlinecustomroofingllc.com','1xlite','riverlayboy.shop','hai8g.com','zoaclachan.cyou','florian.sorrilylivyershape.cyou','ag.phrymaphytic.com','my.rtmark.net','s.click.aliexpress.com','developdomicile.com','cloudflareinsights.com','frowstyambler','qpon','go. ','go.','click.','tracking.','adx.','adv.','banner.','traffic.','redirect.','redirecting.','bestchange','best-'];
          for(var i=0;i<AD_PATTERNS.length;i++){if(l.indexOf(AD_PATTERNS[i])!==-1){try{return new Proxy({},{get:function(){return function(){return null}}})}catch(e){return null}}}
        }
      }catch(e){}
    }
    try{return _origOpen.apply(window,arguments)}catch(e){return null}
  };
})();

(function(){
  var AD_PATTERNS=['doubleclick.net','googleadservices.com','googlesyndication.com','google-analytics.com','googletagmanager.com','gtag/js','pagead2.googlesyndication.com','adnxs.com','rubiconproject.com','criteo.com','criteo.net','outbrain.com','taboola.com','revcontent.com','adsystem.','adserver.','ads.','popads.','popcash.','popunder.','adsterra.com','propellerads.com','trafficfactory.biz','pixel.','track.','tracking.','beacon.','histats.com','statcounter.com','scorecardresearch.com','amazon-adsystem.com','casalemedia.com','contextweb.com','openx.net','pubmatic.com','sharethrough.com','media.net','advertising.com','adap.tv','moatads.com','servedby.','exdynsrv.com','exoclick.com','juicyads.com','plugrush.com','trafficjunky.com','adreactor.com','adcash.com','adhitz.com','adk2.com','adpierce.com','clickadu.com','clicksco.net','hilltopads.com','interlinecustomroofingllc.com','1xlite','riverlayboy.shop','hai8g.com','zoaclachan.cyou','florian.sorrilylivyershape.cyou','ag.phrymaphytic.com','my.rtmark.net','s.click.aliexpress.com','developdomicile.com','cloudflareinsights.com','frowstyambler','qpon','go. ','click.','adx.','adv.','banner.','traffic.','redirect.','redirecting.','bestchange','best-'];
  function isAdUrl(url){if(!url||typeof url!=='string')return false;var l=url.toLowerCase();for(var i=0;i<AD_PATTERNS.length;i++){if(l.indexOf(AD_PATTERNS[i])!==-1)return true}return false}
  try{var _fetch=window.fetch;window.fetch=function(input,init){var url=(typeof input==='string')?input:(input&&input.url)||'';if(isAdUrl(url))return Promise.resolve(new Response('',{status:204}));return _fetch.call(window,input,init)};var _xhrOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){if(isAdUrl(url)){this._aborted=true;return}return _xhrOpen.apply(this,arguments)};var _xhrSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){if(this._aborted)return;return _xhrSend.apply(this,arguments)}}catch(e){}

  function _domInit(){
    try{var _adTimer=null;var obs=new MutationObserver(function(muts){obs.disconnect();clearTimeout(_adTimer);_adTimer=setTimeout(function(){try{obs.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}},3000);for(var i=0;i<muts.length;i++){for(var j=0;j<muts[i].addedNodes.length;j++){var n=muts[i].addedNodes[j];if(n.nodeType!==1)continue;var tag=n.tagName;if(tag==='IFRAME'){var src=n.getAttribute('src')||n.src||'';if(isAdUrl(src)){n.remove();continue}}if(tag==='DIV'||tag==='SECTION'||tag==='ASIDE'){try{var cs=window.getComputedStyle(n);var zIdx=parseInt(cs.zIndex);if(!isNaN(zIdx)&&zIdx>50&&(cs.position==='fixed'||cs.position==='sticky')){if(!n.querySelector('video, iframe[src*="player"], iframe[src*="embed"]')){n.style.display='none'}}}catch(e){}}}});obs.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}

    function _sweepAds(){try{var skipTexts=['skip','skip ad','close ad','continue','continue to video'];var clickables=document.querySelectorAll('button, a, span, div[role="button"]');for(var bi=0;bi<clickables.length;bi++){var txt=(clickables[bi].textContent||'').trim().toLowerCase();if(txt.length>0&&txt.length<30){for(var si=0;si<skipTexts.length;si++){if(txt===skipTexts[si]||txt.indexOf(skipTexts[si])!==-1){var cs=window.getComputedStyle(clickables[bi]);if(cs.position==='fixed'||cs.position==='sticky'||parseInt(cs.zIndex)>50){clickables[bi].click()}}}}}
      var allFixed=document.querySelectorAll('div[style*="position: fixed"],div[style*="position:fixed"],section[style*="position: fixed"],section[style*="position:fixed"]');for(var fi=0;fi<allFixed.length;fi++){var fEl=allFixed[fi];try{var fCs=window.getComputedStyle(fEl);var fZ=parseInt(fCs.zIndex);if(!isNaN(fZ)&&fZ>50&&(fCs.position==='fixed'||fCs.position==='sticky')&&!fEl.querySelector('video, iframe[src*="player"], iframe[src*="embed"]')){fEl.style.display='none'}}catch(e){}}}catch(e){}}
    _sweepAds();try{setInterval(_sweepAds,3000)}catch(e){}
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_domInit)}else{_domInit()}

  document.addEventListener('click',function(e){var el=e.target;while(el&&el!==document.body){if(el.tagName==='A'){var href=el.getAttribute('href')||el.href;if(href&&href.indexOf('#')!==0&&href.indexOf('javascript:')!==0){try{var u=new URL(href,location.href);if(u.hostname!==location.hostname||el.hasAttribute('download')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return false}}catch(err){}}break}el=el.parentElement}},true);

  try{if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(regs){for(var i=0;i<regs.length;i++)regs[i].unregister()});navigator.serviceWorker.register=function(){return Promise.reject(new Error('Blocked'))}}}catch(e){}
  try{document.write=function(){};document.writeln=function(){}}catch(e){}
})();
true;`;

const CONTENT_READY_SCRIPT = `(function(){
  var _fired=false;
  function fire(state){if(_fired)return;_fired=true;try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:content-ready',state:state||document.readyState}))}catch(e){}}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){fire('interactive')})}else{fire(document.readyState)}
  window.addEventListener('load',function(){fire('complete')});
  setTimeout(function(){if(!_fired&&document.readyState!=='complete'){try{document.close()}catch(e){}fire('forced')}},6000);
})();
true;`;

const DOCUMENT_CLOSE_WATCHDOG_SCRIPT = `(function(){
  if(document._closeWatchdogPatched)return;document._closeWatchdogPatched=true;
  var _open=Document.prototype.open;var _close=Document.prototype.close;
  Document.prototype.close=function(){if(this._closeTimer){clearTimeout(this._closeTimer);this._closeTimer=null}return _close.apply(this,arguments)};
  Document.prototype.open=function(){var result=_open.apply(this,arguments);if(this._closeTimer)clearTimeout(this._closeTimer);var self=this;self._closeTimer=setTimeout(function(){try{if(self.readyState==='loading'){try{self.close()}catch(e){}window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:content-ready'}))}}catch(e){}},12000);return result};
})();
true;`;

const CONSOLE_BRIDGE_SCRIPT = `(function(){
  var _send=function(lvl,args){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'console',level:lvl,args:args.map(function(a){try{return String(a)}catch(e){return Object.prototype.toString.call(a)}})}))}catch(e){}};
  ['log','info','warn','error'].forEach(function(lvl){var _orig=console[lvl];console[lvl]=function(){var _args=Array.prototype.slice.call(arguments);_send(lvl,_args);_orig.apply(console,arguments)}});
  window.addEventListener('error',function(e){_send('error',[e.message,'@',e.filename+':'+e.lineno,e.error?e.error.stack:''])});
  window.addEventListener('unhandledrejection',function(e){_send('error',['unhandledrejection',e.reason?(e.reason.stack||String(e.reason)):''])});
})();
true;`;

function makeCFBypassScript(providerHost: string, providerId?: string) {
  const providerSnippet = providerId
    ? generateProviderSnippet(providerConfigs[providerId])
    : '';
  return `(function(){
    try{if(window.top!==window.self){window.top.postMessage({type:'__player:child_anchor',href:location.href,readyState:document.readyState,origin:location.origin,host:location.hostname,ts:Date.now()},'*');window.addEventListener('unload',function(){try{window.top.postMessage({type:'__player:child_unload',href:location.href,ts:Date.now()},'*')}catch(_){}})}}
    catch(e){}
    try{if(window.top===window.self){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'player:diag',data:{msg:'script_boot',ts:Date.now()}}))}}catch(e){}
    try{if(window.top===window.self){setTimeout(function(){var _ifs=document.querySelectorAll('iframe');window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'player:diag',data:{msg:'frame_count',count:_ifs.length,ts:Date.now()}}))},100)}}catch(e){}
    try{Object.defineProperty(navigator,'webdriver',{get:function(){return false}})}catch(e){}
    try{if(!window.chrome){window.chrome={runtime:{},loadTimes:function(){},csi:function(){}}}}catch(e){}
    try{Object.defineProperty(navigator,'plugins',{get:function(){return[1,2,3,4,5]},configurable:true})}catch(e){}
    try{Object.defineProperty(navigator,'languages',{get:function(){return['en-US','en']},configurable:true})}catch(e){}
    try{var _origQuery=window.navigator.permissions.query;window.navigator.permissions.query=function(params){return params.name==='notifications'?Promise.resolve({state:Notification.permission}):_origQuery(params)}}catch(e){}
    try{var _getParam=WebGLRenderingContext.prototype.getParameter;WebGLRenderingContext.prototype.getParameter=function(param){if(param===37445)return'Intel Inc.';if(param===37446)return'Intel Iris OpenGL Engine';return _getParam.call(this,param)}}catch(e){}
    try{var _fs=Element.prototype.requestFullscreen;Element.prototype.requestFullscreen=function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen',entering:true}));return _fs?_fs.apply(this,arguments):Promise.resolve()};var _efs=Element.prototype.exitFullscreen;Element.prototype.exitFullscreen=function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen',entering:false}));return _efs?_efs.apply(this,arguments):Promise.resolve()};document.addEventListener('fullscreenchange',function(){var isFS=!!document.fullscreenElement;window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'cf:fullscreen',entering:isFS}))})}catch(e){}
    window.open=function(){try{return new Proxy({},{get:function(){return function(){return null}}})}catch(e){return null}};
    window.showModalDialog=function(){return null};
    window.showModelessDialog=function(){return null};
    try{var _noopWin=function(){try{return new Proxy({},{get:function(){return function(){return null}}})}catch(e){return null}};Object.defineProperty(window,'open',{value:_noopWin,writable:false,configurable:false})}catch(e){}
    try{document.addEventListener('click',function(e){var target=e.target;while(target){if(target.tagName==='A'&&(target.getAttribute('target')==='_blank'||target.target==='_blank')){e.preventDefault();e.stopPropagation();return false}target=target.parentNode}},true)}catch(e){}
    try{var _origAppendChild=Node.prototype.appendChild;Node.prototype.appendChild=function(node){if(node&&node.tagName==='IFRAME'){var src=(node.getAttribute('src')||node.src||'').toLowerCase();if(src.indexOf('xbm.')!==-1||src.indexOf('mp4.')!==-1||src.indexOf('vidnees')!==-1||src.indexOf('vidapi.')!==-1||src.indexOf('eat-peach')!==-1||src.indexOf('player')!==-1||src.indexOf('embed')!==-1||src.indexOf('/e/')!==-1||src.indexOf('video')!==-1){_videoIframes[src]=node}}if(node&&node.id&&(node.id.indexOf('player')!==-1||node.id.indexOf('video')!==-1||node.id.indexOf('embed')!==-1)){_videoContainer=node}return _origAppendChild.call(this,node)};var _origRemoveChild=Node.prototype.removeChild;Node.prototype.removeChild=function(node){if(node&&node.tagName==='IFRAME'){var src=(node.getAttribute('src')||node.src||'').toLowerCase();if(_isAdSrc(src))return node}return _origRemoveChild.call(this,node)}}catch(e){}

    try{_cfDomInit()}catch(e){}

    function _cfDomInit(){
      var AD_DOMAINS=['doubleclick.net','googleadservices.com','googlesyndication.com','pagead2.','adnxs.com','rubiconproject.com','criteo.','popads.','popcash.','popunder.','adsterra.com','propellerads.com','exoclick.com','juicyads.com','plugrush.com','adcash.com','clickadu.com','cloudflareinsights.com','go.','click.','adx.','traffic.','redirect.','bestchange','ads.','popunders','popad'];
      function _isAdUrl(u){if(!u)return false;var l=u.toLowerCase();for(var di=0;di<AD_DOMAINS.length;di++){if(l.indexOf(AD_DOMAINS[di])!==-1)return true}return false}
      try{new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var nodes=muts[i].addedNodes;for(var j=0;j<nodes.length;j++){var n=nodes[j];if(n.tagName==='IFRAME'){var src=n.getAttribute('src')||n.src||'';if(_isAdUrl(src))n.remove()}}}}).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}
      ${providerSnippet}

      (function(){
        if(window.top===window.self)return;
        var _seekInterval=null;
        var _finder=setInterval(function(){
          var _videos=document.querySelectorAll('video');if(!_videos.length)return;
          var _v=_videos[0];for(var _i=1;_i<_videos.length;_i++){if(_videos[_i].videoWidth*_videos[_i].videoHeight>_v.videoWidth*_v.videoHeight){_v=_videos[_i]}}
          clearInterval(_finder);
          try{window.top.postMessage({type:'__player:diag',msg:'found_video',vw:_v.videoWidth,vh:_v.videoHeight},'*')}catch(e){}
          var _lastSent=0;
          _v.addEventListener('timeupdate',function(){try{if(_v.duration<=0||_v.currentTime<=5)return;var _now=Date.now();if(_now-_lastSent<5000)return;_lastSent=_now;window.top.postMessage({type:'__player:progress',currentTime:_v.currentTime,duration:_v.duration,percent:_v.currentTime/_v.duration},'*');try{window.top.postMessage({type:'__player:diag',msg:'progress_posted',ct:_v.currentTime,dur:_v.duration},'*')}catch(e){}}catch(e){}});
          window.addEventListener('message',function(e){if(!e.data||e.data.type!=='__player:seek')return;if(_seekInterval)clearInterval(_seekInterval);_seekInterval=setInterval(function(){if(_v.readyState>=1){try{_v.currentTime=e.data.time;if(e.data.play)_v.play().catch(function(){})}catch(ex){}clearInterval(_seekInterval);_seekInterval=null}},200)});
        },500);
      })();
    }
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_cfDomInit)}else{_cfDomInit()}
  })();
  true;`;
}

function makeConsolidatedScript(providerHost: string, providerId?: string): string {
  const scripts = [
    POPUP_BLOCKER_SCRIPT,
    CONTENT_READY_SCRIPT,
    DOCUMENT_CLOSE_WATCHDOG_SCRIPT,
    makeCFBypassScript(providerHost, providerId),
  ];
  const innerBodies: string[] = [];
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    const body = s
      .replace(/^\s*\(function\s*\(\)\s*\{?/, '')
      .replace(/\}\s*\)\s*\(\s*\)\s*;?\s*true\s*;?\s*$/, '')
      .replace(/^\s*true\s*;?\s*$/, '')
      .trim();
    if (body) innerBodies.push(body);
  }
  return `(function(){\n${innerBodies.join('\n\n')}\n})();\ntrue;`;
}

interface VideoWebViewProps {
  type: 'movie' | 'tv';
  id: string;
  season?: number;
  episode?: number;
  onClose?: () => void;
  initialProvider?: string;
  backdropUrl?: string;
}

export function VideoWebView({
  type,
  id,
  season,
  episode,
  onClose,
  initialProvider,
  backdropUrl,
}: VideoWebViewProps) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
  const webViewRef = useRef<PlayerWebViewRef>(null);
  const providerHostRef = useRef<string>('');
  const navigationChainRef = useRef<Set<string>>(new Set());
  const pageLoadedRef = useRef(false);
  const navigationGenRef = useRef(0);
  const navigationAttemptsRef = useRef(0);
  const navigationReceivedRef = useRef(false);
  const progressRef = useRef<{ currentTime: number; duration: number; percent: number }>({ currentTime: 0, duration: 0, percent: 0 });
  const startAtRef = useRef<number>(0);
  const [startAtTime, setStartAtTime] = useState<number>(0);
  const lastSavePctRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [slideInReady, setSlideInReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlideInReady(true), 350);
    return () => clearTimeout(timer);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [auditMode, setAuditMode] = useState(false);
  const [auditHosts, setAuditHosts] = useState<string[]>([]);

  // â”€â”€ Overlay auto-hide (only in fullscreen) â”€â”€
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setOverlayVisible(false));
    }, 3000);
  }, [overlayOpacity]);

  const showOverlay = useCallback(() => {
    setOverlayVisible(true);
    Animated.timing(overlayOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    scheduleHide();
  }, [overlayOpacity, scheduleHide]);

  const providers = useMemo(() => getEnabledProviders(), []);

  const [providerId, setProviderId] = useState<string>(
    initialProvider && providers.some((p) => p.id === initialProvider)
      ? initialProvider
      : providers[0]?.id ?? '',
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (isFullscreen) {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      scheduleHide();
    } else {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setOverlayVisible(true);
      Animated.timing(overlayOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isFullscreen, scheduleHide, overlayOpacity]);

  const orientationRestoredRef = useRef(false);
  const restorePortrait = useCallback(() => {
    if (orientationRestoredRef.current) return;
    orientationRestoredRef.current = true;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);
  useEffect(() => {
    return () => { if (!orientationRestoredRef.current) { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); } };
  }, []);

  const [showEpPicker, setShowEpPicker] = useState(false);
  const [currentSeason, setCurrentSeason] = useState<number>(season ?? 1);
  const [currentEpisode, setCurrentEpisode] = useState<number>(episode ?? 1);

  // â”€â”€ Load watch history on mount to determine resume point â”€â”€
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    (async () => {
      try {
        if (type === 'tv') {
          const resume = await getResumePoint(id, 'tv', currentSeason, currentEpisode);
          if (resume) {
            if (resume.season != null && resume.episode != null) {
              setCurrentSeason(resume.season);
              setCurrentEpisode(resume.episode);
            }
            if (resume.currentTime > 5 && !resume.completed) {
              startAtRef.current = resume.currentTime;
              setStartAtTime(resume.currentTime);
              if (pageLoadedRef.current) {
                seekTo(resume.currentTime);
              }
            }
          }
        } else {
          const progress = await getProgress(id, 'movie');
          if (progress && !progress.completed && progress.currentTime > 5) {
            startAtRef.current = progress.currentTime;
            setStartAtTime(progress.currentTime);
            if (pageLoadedRef.current) {
              seekTo(progress.currentTime);
            }
          }
        }
      } catch { /* silent */ }
    })();
  }, [type, id, currentSeason, currentEpisode]);

  const currentProvider = providers.find((p) => p.id === providerId);
  const isTV = type === 'tv';

  useEffect(() => {
    if (currentProvider) {
      try { providerHostRef.current = new URL(currentProvider.baseUrl).hostname; } catch (e) { providerHostRef.current = ''; }
    }
  }, [currentProvider]);

  useEffect(() => {
    navigationReceivedRef.current = false;
    const gen = navigationGenRef.current;
    const noNavTimer = setTimeout(() => { if (!navigationReceivedRef.current) { setLoading(false); } }, 30000);
    const safetyTimer = setTimeout(() => { setLoading(false); }, 35000);
    return () => { clearTimeout(noNavTimer); clearTimeout(safetyTimer); };
  }, [providerId, currentSeason, currentEpisode]);

  const watchUrl = useMemo(() => {
    if (!currentProvider) return '';
    const startAt = startAtTime > 0 ? startAtTime : undefined;
    const embedPath = type === 'tv' && currentSeason && currentEpisode
      ? currentProvider.embed.tv(id, currentSeason, currentEpisode, startAt)
      : currentProvider.embed.movie(id, startAt);
    return `${currentProvider.baseUrl}${embedPath}`;
  }, [currentProvider, type, id, currentSeason, currentEpisode, startAtTime]);

  const seekTo = useCallback((time: number) => {
    webViewRef.current?.injectJavaScript(`
      if (window.__playerSeek) { window.__playerSeek(${Math.floor(time)}, true); }
      true;
    `);
  }, []);

  const handleClose = useCallback(() => {
    restorePortrait();
    const prog = progressRef.current;
    if (prog.currentTime > 5) {
      saveProgress({
        tmdbId: id,
        mediaType: type,
        providerId,
        currentTime: prog.currentTime,
        duration: prog.duration,
        percent: prog.percent,
        season: isTV ? currentSeason : undefined,
        episode: isTV ? currentEpisode : undefined,
        updatedAt: Date.now(),
        completed: prog.percent >= 0.95,
      }).catch(() => {});
    }
    setTimeout(() => onClose?.(), 200);
  }, [restorePortrait, onClose, id, type, providerId, isTV, currentSeason, currentEpisode]);

  // â”€â”€ Periodic force-save (every 15s) â”€â”€
  useEffect(() => {
    const intervalId = setInterval(() => {
      const prog = progressRef.current;
      if (prog.currentTime > 5) {
        saveProgress({
          tmdbId: id,
          mediaType: type,
          providerId,
          currentTime: prog.currentTime,
          duration: prog.duration,
          percent: prog.percent,
          season: isTV ? currentSeason : undefined,
          episode: isTV ? currentEpisode : undefined,
          updatedAt: Date.now(),
          completed: prog.percent >= 0.95,
        }).catch(() => {});
      }
    }, 15000);
    return () => clearInterval(intervalId);
  }, [id, type, providerId, isTV, currentSeason, currentEpisode]);

  // â”€â”€ Save progress on unmount â”€â”€
  const unmountSavedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (unmountSavedRef.current) return;
      unmountSavedRef.current = true;
      const prog = progressRef.current;
      if (prog.currentTime > 5) {
        saveProgress({
          tmdbId: id,
          mediaType: type,
          providerId,
          currentTime: prog.currentTime,
          duration: prog.duration,
          percent: prog.percent,
          season: isTV ? currentSeason : undefined,
          episode: isTV ? currentEpisode : undefined,
          updatedAt: Date.now(),
          completed: prog.percent >= 0.95,
        }).catch((err: unknown) => console.warn('Unmount save failed', err));
      }
    };
  }, [id, type, providerId, isTV, currentSeason, currentEpisode]);

  const switchProvider = (newId: string) => {
    clearAllState().catch(() => {});
    setProviderId(newId);
    setMountGen((g) => g + 1);
    if (newId !== providerId) setLoading(true);
    setError(null);
    setShowPicker(false);
    navigationChainRef.current = new Set();
    pageLoadedRef.current = false;
    navigationGenRef.current += 1;
    navigationAttemptsRef.current = 0;
    const latestTime = (progressRef.current as any).currentTime ?? 0;
    if (latestTime > 5) { startAtRef.current = latestTime; setStartAtTime(latestTime); }
  };

  const [mountGen, setMountGen] = useState(0);
  const webViewKey = `player-${mountGen}`;

  const getProviderDisplayName = (p: ProviderDefinition): string => p.displayName || p.name || p.id;

  const retry = () => {
    if (error) { setError(null); setLoading(true); }
    navigationAttemptsRef.current = 0;
    setMountGen((g) => g + 1);
  };

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950 px-8">
        <View className="w-16 h-16 rounded-full bg-red-500/10 items-center justify-center mb-5">
          <Ionicons name="alert-circle" size={32} color="#ef4444" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">Playback Error</Text>
        <Text className="text-zinc-500 text-sm mb-8 text-center leading-5">{error}</Text>
        <View className="flex-row gap-3">
          <TouchableOpacity onPress={retry} className="bg-primary rounded-xl py-3 px-6 flex-row items-center" activeOpacity={0.8}>
            <Ionicons name="refresh" size={16} color="#000" />
            <Text className="text-black font-bold text-sm ml-2">Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowPicker(true)} className="bg-zinc-800 rounded-xl py-3 px-6 flex-row items-center" activeOpacity={0.8}>
            <Ionicons name="server" size={16} color="#d4d4d8" />
            <Text className="text-zinc-300 font-bold text-sm ml-2">Switch Server</Text>
          </TouchableOpacity>
        </View>
        <ServerPickerSheet
          visible={showPicker}
          providers={providers}
          currentId={providerId}
          onSelect={switchProvider}
          onClose={() => setShowPicker(false)}
          getDisplayName={getProviderDisplayName}
        />
      </View>
    );
  }

  // â”€â”€ Empty URL guard â”€â”€
  if (!watchUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-8">
        <View className="w-16 h-16 rounded-full bg-zinc-800 items-center justify-center mb-5">
          <Ionicons name="server" size={28} color="#52525B" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">No player available</Text>
        <Text className="text-zinc-500 text-sm mb-8 text-center leading-5">
          No streaming servers are available. Try selecting a different server.
        </Text>
        <TouchableOpacity onPress={() => setShowPicker(true)} className="bg-primary rounded-xl py-3 px-6 flex-row items-center" activeOpacity={0.8}>
          <Ionicons name="server" size={16} color="#000" />
          <Text className="text-black font-bold text-sm ml-2">Choose Server</Text>
        </TouchableOpacity>
        <ServerPickerSheet
          visible={showPicker}
          providers={providers}
          currentId={providerId}
          onSelect={switchProvider}
          onClose={() => setShowPicker(false)}
          getDisplayName={getProviderDisplayName}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {/* â”€â”€ Controls overlay â”€â”€ */}
      <PlayerControlOverlay
        isFullscreen={isFullscreen}
        isTV={isTV}
        loading={loading}
        overlayVisible={overlayVisible}
        showOverlay={showOverlay}
        overlayOpacity={overlayOpacity}
        onClose={handleClose}
        onToggleFullscreen={() => setIsFullscreen((f) => !f)}
        onServerPickerOpen={() => setShowPicker(true)}
        onEpisodePickerOpen={() => { setShowEpPicker(true); }}
        currentSeason={currentSeason}
        currentEpisode={currentEpisode}
        providerDisplayName={currentProvider ? getProviderDisplayName(currentProvider) : 'Server'}
        providerId={providerId}
        auditMode={auditMode}
      />

      {/* â”€â”€ Server picker modal â”€â”€ */}
      <ServerPickerSheet
        visible={showPicker}
        providers={providers}
        currentId={providerId}
        onSelect={switchProvider}
        onClose={() => setShowPicker(false)}
        getDisplayName={getProviderDisplayName}
      />

      {/* â”€â”€ Episode picker modal (TV only) â”€â”€ */}
      {isTV && (
        <EpisodeRail
          visible={showEpPicker}
          tvId={id}
          currentSeason={currentSeason}
          currentEpisode={currentEpisode}
          onSelect={(s, e) => {
            setCurrentSeason(s);
            setCurrentEpisode(e);
            setShowEpPicker(false);
            if (s !== currentSeason || e !== currentEpisode) {
              setMountGen((g) => g + 1);
              setLoading(true);
            }
          }}
          onClose={() => setShowEpPicker(false)}
        />
      )}

      {/* â”€â”€ Audit Results Modal â”€â”€ */}
      <Modal visible={auditHosts.length > 0 && !auditMode} transparent animationType="fade" onRequestClose={() => setAuditHosts([])}>
        <View className="flex-1 bg-black/70 items-center justify-center px-6">
          <View className="bg-zinc-900 rounded-2xl w-full max-h-[60%] p-5 border border-zinc-800">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="radio-outline" size={18} color="#D4A237" />
                <Text className="text-white text-lg font-bold">Discovered Domains</Text>
              </View>
              <TouchableOpacity onPress={() => setAuditHosts([])} activeOpacity={0.7} accessibilityLabel="Close audit results" accessibilityRole="button">
                <Ionicons name="close" size={20} color="#71717a" />
              </TouchableOpacity>
            </View>
            <Text className="text-zinc-400 text-xs mb-3">
              {auditHosts.length} unique hosts captured during this session.
            </Text>
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {auditHosts.map((host, i) => (
                <View key={host} className="flex-row items-center py-2 px-3 rounded-lg mb-1 bg-zinc-800/50">
                  <Text className="text-zinc-300 text-xs font-mono flex-1">{host}</Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              onPress={() => { console.warn(`[Audit] JSON:\n${JSON.stringify(auditHosts, null, 2)}`); setAuditHosts([]); }}
              className="bg-primary rounded-xl py-3 mt-4 items-center"
              activeOpacity={0.8}
            >
              <Text className="text-black font-bold text-sm">Export & Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* â”€â”€ Player area â”€â”€ */}
      <View
        style={!isFullscreen
          ? { height: providerId === 'nxsha' ? SCREEN_HEIGHT * 0.40 : SCREEN_HEIGHT * 0.68, justifyContent: 'center', marginTop: insets.top + 40 }
          : { flex: 1 }
        }
      >
        {backdropUrl && loading && (
          <Image
            source={{ uri: getImageUrl(backdropUrl, 'w780') }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="cover"
            blurRadius={Platform.OS === 'android' ? 10 : 20}
          />
        )}
        <View style={!isFullscreen ? { width: '100%', height: '100%', backgroundColor: '#000' } : { flex: 1 }}>
          <PlayerWebView
            key={webViewKey}
            ref={webViewRef}
            source={{ uri: slideInReady ? watchUrl : '' }}
            style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
            allowsFullscreenVideo={true}
            injectedJavaScriptBeforeContentLoaded={
              currentProvider?.baseUrl
                ? makeConsolidatedScript(new URL(currentProvider.baseUrl).hostname, currentProvider.id)
                : ''
            }
            referrer={currentProvider?.baseUrl || ''}
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            auditMode={auditMode}
            onAuditData={(event) => {
              const { hosts: hostsStr } = event.nativeEvent;
              const domains = hostsStr ? hostsStr.split(',').filter(Boolean) : [];
              setAuditHosts(domains);
            }}
            userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36"
            onLoadingStart={(event) => {
              navigationReceivedRef.current = true;
            }}
            onLoadingFinish={(event) => {
              setLoading(false);
              const gen = navigationGenRef.current;
              setTimeout(() => {
                if (navigationGenRef.current === gen && !pageLoadedRef.current) {
                  pageLoadedRef.current = true;
                }
              }, 15000);
              const seekTime = startAtRef.current;
              if (seekTime > 5) {
                seekTo(seekTime);
                startAtRef.current = 0;
              }
            }}
            onHttpError={(syntheticEvent) => {
              const err = syntheticEvent.nativeEvent;
              setLoading(false);
              if (err.statusCode === 403 && providerId === 'toustream') {
                setError('Server 19 is behind Cloudflare protection and cannot be accessed directly. Please try a different server.');
              }
            }}
            onRenderProcessGone={() => {
              setLoading(true);
              setMountGen((g) => g + 1);
            }}
            onMessage={(event) => {
              try {
                const data = JSON.parse(event.nativeEvent.data);
                if (data.type === '__diag' || data.type === 'player:diag') {
                  return;
                }
                if (data.type === 'cf:content-ready') {
                  setLoading(false);
                  navigationReceivedRef.current = true;
                  pageLoadedRef.current = true;
                  const seekTime = startAtRef.current;
                  if (seekTime > 5) { seekTo(seekTime); startAtRef.current = 0; }
                  return;
                }
                if (data.type === 'cf:fullscreen') {
                  if (data.entering) {
                    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
                    setOverlayVisible(false);
                    overlayOpacity.setValue(0);
                  } else {
                    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
                    setOverlayVisible(true);
                    Animated.timing(overlayOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
                  }
                  return;
                }
                if (data.type === 'console') {
                  const level = data.level || 'log';
                  const args = data.args || [];
                  const text = args.join(' ');
                  if (level === 'error' || level === 'warn') {
                    console.warn(`[Page:${level.toUpperCase()}] ${text}`);
                  }
                  return;
                }
                if (data.type === 'player:progress' || data.type === 'screenscape:progress') {
                  const { currentTime = 0, duration = 0, percent: pct = 0 } = data.data ?? {};
                  const newPct = duration > 0 ? currentTime / duration : pct;
                  const prevPct = progressRef.current.percent;
                  if (newPct >= prevPct) {
                    progressRef.current = { currentTime, duration, percent: newPct };
                  }
                  if (currentTime > 5) {
                    const pctDiff = newPct - lastSavePctRef.current;
                    if (pctDiff >= 0.05 || newPct >= 0.95) {
                      lastSavePctRef.current = newPct;
                      saveProgress({
                        tmdbId: id,
                        mediaType: type,
                        providerId,
                        currentTime,
                        duration,
                        percent: newPct,
                        season: isTV ? currentSeason : undefined,
                        episode: isTV ? currentEpisode : undefined,
                        updatedAt: Date.now(),
                        completed: newPct >= 0.95,
                      }).catch(() => {});
                    }
                  }
                  if (isTV && prevPct < 0.95 && newPct >= 0.95) {
                    markCompleted(id, 'tv', currentSeason, currentEpisode).catch(() => {});
                  }
                }
              } catch(e) {}
            }}
          />
        </View>
      </View>
    </View>
  );
}
