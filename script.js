let map = null;
let watchId = null;
let recording = false;
let route = [];
let totalDistance = 0;
let startedAt = 0;
let timerId = null;
let storageAvailable = true;
let is3D = true;
let territories = [];
const HISTORY_KEY = "projectAtlasMissionHistoryV1";
const TERRITORY_KEY = "projectAtlasTerritoriesV1";
const PLAYER_NAME_KEY = "projectAtlasPlayerNameV1";
const PLAYER_ID_KEY = "projectAtlasPlayerIdV1";
const DEFAULT_PLAYER_ID = "AT-1001";
const GPS_MAX_ACCURACY_METERS = 35;
const GPS_MAX_SPEED_MPS = 8.5;
const GPS_MAX_AGE_MS = 15000;
const GPS_MIN_STEP_METERS = 4;
const MIN_TERRITORY_AREA_M2 = 10;
// This file is the GitHub Pages prototype, so prototype-only cleanup tools are enabled here. Remove them before any production release.
let currentGpsMarker = null;
const routeSourceId = "atlas-route";
const routeLayerId = "atlas-route-line";
const routePointSourceId = "atlas-route-points";

function setMapStatus(message){
 const el=document.getElementById("mapStatus");
 if(el)el.textContent=message;
}
function initMap(){
 if(!window.maplibregl){
  setMapStatus("Map library did not load. Check internet and reload.");
  document.getElementById("zoneName").textContent="Map unavailable";
  return;
 }
 try{
  map = new maplibregl.Map({
   container:"atlasMap",
   style:"https://tiles.openfreemap.org/styles/bright",
   center:[84.8,23.7],
   zoom:5.2,
   pitch:52,
   bearing:-12,
   maxPitch:75,
   antialias:true,
   attributionControl:true,
   touchZoomRotate:true,
   dragRotate:true,
   pitchWithRotate:true
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:false,visualizePitch:true}),"top-right");
  map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:"metric"}),"bottom-right");
  map.on("load",()=>{
   try{
    // Esri World Imagery provides real aerial imagery; usage is subject to Esri terms and may change.
    map.addSource("atlas-satellite-imagery",{type:"raster",tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],tileSize:256,maxzoom:19,attribution:"Imagery © Esri and its licensors"});
    const firstLabel=(map.getStyle().layers||[]).find(layer=>layer.type==="symbol"&&layer.layout&&layer.layout["text-field"]);
    map.addLayer({id:"atlas-satellite-imagery-layer",type:"raster",source:"atlas-satellite-imagery",paint:{"raster-opacity":1}},firstLabel?firstLabel.id:undefined);
    map.addSource("openfreemap-buildings",{type:"vector",url:"https://tiles.openfreemap.org/planet"});
    const layers=map.getStyle().layers||[];
    let labelLayerId;
    for(const layer of layers){
     if(layer.type==="symbol" && layer.layout && layer.layout["text-field"]){labelLayerId=layer.id;break;}
    }
    
map.addLayer({
  id: "atlas-3d-buildings",
  source: "openfreemap-buildings",
  "source-layer": "building",
  type: "fill-extrusion",
  minzoom: 13,
  filter: ["!=", ["get", "hide_3d"], true],
  paint: {
    "fill-extrusion-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "render_height"], ["get", "height"], 8],
      0, "#d8e1e8",
      20, "#b8cbd5",
      80, "#8ba9bb",
      200, "#668ba5"
    ],
    "fill-extrusion-height": [
      "interpolate",
      ["linear"],
      ["zoom"],
      13, 0,
      15, ["coalesce", ["get", "render_height"], ["get", "height"], 8]
    ],
    "fill-extrusion-base": [
      "interpolate",
      ["linear"],
      ["zoom"],
      13, 0,
      15, ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0]
    ],
    "fill-extrusion-opacity": 0.95
  }
}, labelLayerId);
    
    setMapStatus("Satellite imagery loaded where available · 3D buildings depend on local data");
   }catch(e){
    console.warn("3D building layer could not be added",e);
    setMapStatus("Satellite imagery available; 3D building data unavailable here");
   }
   addRouteLayers();
  });
  map.on("error",e=>{console.warn("Map error",e.error||e); const sourceId=e&&e.sourceId; if(sourceId==="atlas-satellite-imagery"){setMapStatus("Satellite tiles unavailable at this location/zoom. Try zooming out one or two levels; other map layers may still work.");}});
 }catch(error){
  console.error(error);
  setMapStatus("Map could not start. Reload and check connection.");
 }
}
function goToMyLocation(){
 if(!navigator.geolocation){say("This browser does not provide location access.");return;}
 if(!window.isSecureContext){say("Current location requires the published HTTPS website.");return;}
 say("Finding your current location… allow location permission if prompted.");
 navigator.geolocation.getCurrentPosition(position=>{
  const c=position.coords;
  if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)){say("The device returned an invalid location. Try again outdoors or near a window.");return;}
  const point=[c.longitude,c.latitude];
  if(currentGpsMarker)currentGpsMarker.remove();
  currentGpsMarker=new maplibregl.Marker({color:"#087cff"}).setLngLat(point).addTo(map);
  map.flyTo({center:point,zoom:17,pitch:is3D?55:0,bearing:map.getBearing(),duration:1000});
  say("Current location centred · reported accuracy about "+Math.round(c.accuracy)+" m.");
 },error=>{say(error.code===1?"Location permission denied. Allow location in browser settings.":error.code===2?"Current location is unavailable. Check device location settings.":"Location request timed out. Try again.");},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
}
function locateMyTerritory(){
 if(!map){say("Map is still loading.");return;}
 const id=getPlayerId();
 const mine=territories.filter(t=>t.playerId===id&&getTerritoryGeometry(t));
 if(!mine.length){say("You do not have any saved territories for Player ID "+id+" yet.");return;}
 const bounds=new maplibregl.LngLatBounds();
 mine.forEach(t=>{const g=getTerritoryGeometry(t);const visit=coords=>{if(Array.isArray(coords)&&typeof coords[0]==="number"&&typeof coords[1]==="number")bounds.extend(coords);else if(Array.isArray(coords))coords.forEach(visit);};visit(g.coordinates);});
 if(!bounds.isEmpty())map.fitBounds(bounds,{padding:{top:70,bottom:95,left:45,right:45},maxZoom:16,duration:1000});
 say("Showing "+mine.length+" territory patch(es) owned by "+id+".");
}

function toggle3D(){
 if(!map)return;
 is3D=!is3D;
 map.easeTo({pitch:is3D?55:0,bearing:is3D?-12:0,duration:800});
 const btn=document.getElementById("viewModeBtn");if(btn)btn.textContent=is3D?"3D / FLAT":"FLAT / 3D";
 setMapStatus(is3D?"3D camera enabled":"Flat view enabled");
}
function say(message){document.getElementById("status").textContent=message;}
function setButton(active){
 const btn=document.getElementById("toggleBtn");
 btn.textContent=active?"STOP MISSION":"START MISSION";
 btn.classList.toggle("secondary",active);
}
function toggleTracking(){if(recording)stopTracking();else startTracking();}
function distanceBetween(a,b){
 const R=6371000,rad=x=>x*Math.PI/180;
 const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
 const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
 return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function formatDistance(d){return d>=1000?(d/1000).toFixed(2)+" km":Math.round(d)+" m";}
function formatArea(a){if(a===null||!Number.isFinite(a))return "Unavailable";return a>=10000?(a/10000).toFixed(2)+" ha":Math.round(a)+" m²";}
function updateDistance(){
 document.getElementById("distance").textContent=formatDistance(totalDistance);
 document.getElementById("points").textContent=route.length;
}
function updateTimer(){
 if(!startedAt)return;
 const seconds=Math.floor((Date.now()-startedAt)/1000);
 document.getElementById("duration").textContent=String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
}
function addRouteLayers(){
 if(!map||map.getSource(routeSourceId))return;
 map.addSource(routeSourceId,{type:"geojson",data:{type:"Feature",geometry:{type:"LineString",coordinates:[]},properties:{}}});
 map.addLayer({id:routeLayerId,type:"line",source:routeSourceId,layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#00b879","line-width":5,"line-opacity":0.95}});
 map.addSource(routePointSourceId,{type:"geojson",data:{type:"FeatureCollection",features:[]}});
 map.addLayer({id:"atlas-route-points-layer",type:"circle",source:routePointSourceId,paint:{"circle-radius":7,"circle-color":"#178cff","circle-stroke-color":"#ffffff","circle-stroke-width":2}});
 map.addSource("atlas-territories",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
 map.addLayer({id:"atlas-territory-fill",type:"fill",source:"atlas-territories",paint:{"fill-color":["get","playerColor"],"fill-opacity":0.30}});
 map.addLayer({id:"atlas-territory-outline",type:"line",source:"atlas-territories",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":["get","playerColor"],"line-width":4}});
 map.addSource("atlas-territory-labels",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
 map.addLayer({id:"atlas-territory-labels-layer",type:"symbol",source:"atlas-territory-labels",
  layout:{"text-field":["get","label"],"text-size":12,"text-anchor":"center","text-allow-overlap":true,"text-ignore-placement":true,"text-max-width":12},
  paint:{"text-color":"#073d2c","text-halo-color":"#d8ffe9","text-halo-width":1.5}});
 map.on("click","atlas-territory-fill",event=>{
  const props=event.features&&event.features[0]&&event.features[0].properties;
  if(!props)return;
  let missions=[];
  try{missions=JSON.parse(props.missions||"[]");}catch(error){}
  const missionHtml=missions.length
   ? missions.map((m,i)=>"<div style='margin-top:10px;padding-top:8px;border-top:1px solid #d4dbe3'><strong>"+escapeHtml(m.missionName||("Mission "+(missions.length-i)))+"</strong><br>Status: "+escapeHtml(m.status||"Completed")+"<br>Points: "+escapeHtml(m.points??"—")+"</div>").join("")
   : "<p>No completed mission summaries are linked to this territory yet.</p>";
  new maplibregl.Popup({maxWidth:"300px"}).setLngLat(event.lngLat)
   .setHTML("<div style='color:#152033'><strong>"+escapeHtml(props.ownerName)+"</strong><br>Player ID: "+escapeHtml(props.playerId)+"<br>Area: "+escapeHtml(props.areaLabel)+"<h4 style='margin:12px 0 4px'>Territory missions</h4>"+missionHtml+"</div>")
   .addTo(map);
 });
 map.on("mouseenter","atlas-territory-fill",()=>{map.getCanvas().style.cursor="pointer";});
 map.on("mouseleave","atlas-territory-fill",()=>{map.getCanvas().style.cursor="";});
 updateRouteOnMap();
 updateTerritoriesOnMap();
}
function updateRouteOnMap(){
 if(!map||!map.isStyleLoaded()||!map.getSource(routeSourceId)||!map.getSource(routePointSourceId))return;
 const coords=route.map(p=>[p.lon,p.lat]);
 map.getSource(routeSourceId).setData({type:"Feature",properties:{},geometry:{type:"LineString",coordinates:coords.length?coords:[[0,0]]}});
 map.getSource(routePointSourceId).setData({type:"FeatureCollection",features:route.map((p,i)=>({type:"Feature",properties:{index:i},geometry:{type:"Point",coordinates:[p.lon,p.lat]}}))});
}

function startTracking(){
 if(recording)return;

 if(!navigator.geolocation){
  say("GPS is not available in this browser.");
  return;
 }

 if(!window.isSecureContext){
  say("GPS requires HTTPS. Open the published GitHub Pages website.");
  return;
 }

 route=[];
 totalDistance=0;
 startedAt=Date.now();

 document.getElementById("distance").textContent="0 m";
 document.getElementById("duration").textContent="00:00";
 document.getElementById("area").textContent="Waiting for GPS…";
 document.getElementById("points").textContent="0";
 document.getElementById("missionStatus").textContent="IN PROGRESS";

 recording=true;
 setButton(true);
 updateTimer();
 timerId=setInterval(updateTimer,1000);
 say("Requesting fresh, high-accuracy GPS readings…");

 updateRouteOnMap();

 try{
  watchId=navigator.geolocation.watchPosition(position=>{
   if(!recording)return;

   const c=position.coords;
   const accuracy=c.accuracy;

   if(!Number.isFinite(accuracy)){
    say("GPS accuracy unavailable. Waiting for another reading…");
    return;
   }

   if(accuracy>GPS_MAX_ACCURACY_METERS){
    say("GPS accuracy is weak ("+
        Math.round(accuracy)+" m). Keep waiting for a better reading.");
    return;
   }

   const point={lat:c.latitude,lon:c.longitude,accuracy:accuracy,time:position.timestamp};
   if(!Number.isFinite(point.lat)||!Number.isFinite(point.lon)||Math.abs(point.lat)>90||Math.abs(point.lon)>180){say("Invalid GPS coordinates ignored.");return;}
   if(!Number.isFinite(point.time)||Math.abs(Date.now()-point.time)>GPS_MAX_AGE_MS){say("GPS timestamp is stale or invalid. Waiting for a fresh reading.");return;}

   const last=route[route.length-1];

   if(last){
    const step=distanceBetween(last,point);
    const elapsed=(point.time-last.time)/1000;
    if(!Number.isFinite(elapsed)||elapsed<=0){say("GPS timestamp did not advance. Reading ignored.");return;}
    const speed=step/elapsed;
    if(speed>GPS_MAX_SPEED_MPS&&step>Math.max(12,accuracy+last.accuracy)){say("Suspicious GPS jump ignored ("+Math.round(speed)+" m/s). Waiting for stable readings.");return;}

    if(step < Math.max(GPS_MIN_STEP_METERS, (accuracy + last.accuracy) / 2)){
     say("GPS accuracy: "+Math.round(accuracy)+
         " m. Location stable; waiting for movement.");
     return;
    }

    if(step>Math.max(60,accuracy+last.accuracy+20)){
     say("GPS jump detected ("+Math.round(step)+
         " m). Ignoring this point and waiting for a stable reading.");
     return;
    }
   }

   if(last){
    totalDistance+=distanceBetween(last,point);
   }

   route.push(point);
   updateDistance();
   updateRouteOnMap();

   setMapStatus("GPS recording · accuracy "+
                Math.round(accuracy)+" m");

   say("GPS point "+route.length+" recorded · accuracy "+
       Math.round(accuracy)+" m.");

   document.getElementById("zoneOwner").textContent=
    "GPS accuracy: about "+Math.round(accuracy)+
    " metres. Recorded points: "+route.length;

   if(route.length===1 && map){
    map.flyTo({
     center:[point.lon,point.lat],
     zoom:17,
     pitch:is3D?58:0,
     duration:1000
    });
   }

  },error=>{
   let message="GPS error: "+error.message;

   if(error.code===1)message="Location permission denied. Allow location in Chrome.";
   if(error.code===2)message="Location unavailable. Check laptop location settings and Wi-Fi.";
   if(error.code===3)message="GPS timed out. Wait a moment and try again.";

   stopTracking(true,message);

  },{
   enableHighAccuracy:true,
   maximumAge:0,
   timeout:30000
  });

 }catch(error){
  stopTracking(true,"Could not start GPS: "+error.message);
 }
}
function estimateArea(points){
 if(points.length<4)return null;
 const lat0=points.reduce((s,p)=>s+p.lat,0)/points.length;
 const lon0=points.reduce((s,p)=>s+p.lon,0)/points.length;
 const R=6371000,rad=Math.PI/180;
 const xy=points.map(p=>({x:(p.lon-lon0)*rad*R*Math.cos(lat0*rad),y:(p.lat-lat0)*rad*R}));
 let sum=0;
 for(let i=0;i<xy.length;i++){const j=(i+1)%xy.length;sum+=xy[i].x*xy[j].y-xy[j].x*xy[i].y;}
 return Math.abs(sum)/2;
}
function getHistory(){
 try{const raw=localStorage.getItem(HISTORY_KEY);if(!raw)return [];const data=JSON.parse(raw);return Array.isArray(data)?data:[];}
 catch(error){storageAvailable=false;return [];}
}
function saveHistory(history){
 try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history));storageAvailable=true;return true;}
 catch(error){storageAvailable=false;return false;}
}
function stopTracking(fromError=false,errorMessage=""){
 if(!recording)return;
 recording=false;
 if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}
 if(timerId!==null){clearInterval(timerId);timerId=null;}
 setButton(false);updateTimer();
 if(fromError){document.getElementById("missionStatus").textContent="INTERRUPTED";document.getElementById("area").textContent="Unavailable";say(errorMessage+" This session was not saved to history.");return;}
 document.getElementById("missionStatus").textContent="FINISHED";
 if(route.length<4){document.getElementById("area").textContent="Unavailable";say("Session stopped. Only "+route.length+" reliable GPS points were recorded. At least 4 points are needed for an area estimate. No territory was captured.");return;}
 const estimated=estimateArea(route);
 // Shoelace area can cancel to zero on a self-crossing route; polygonization below is authoritative.
 document.getElementById("area").textContent=estimated===null||!Number.isFinite(estimated)?"Calculating…":formatArea(estimated);
 const elapsedSeconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
 const duration=String(Math.floor(elapsedSeconds/60)).padStart(2,"0")+":"+String(elapsedSeconds%60).padStart(2,"0");
 const record={date:new Date().toLocaleString(),distance:Math.round(totalDistance*100)/100,duration:duration,area:Number.isFinite(estimated)?Math.round(estimated*100)/100:0};
 const history=getHistory();history.unshift(record);
 const historySaved=saveHistory(history.slice(0,50));

 const first=route[0],last=route[route.length-1];
 // The route is closed automatically below; the player does not need to return to point A.
 if(!window.turf||!turf.difference||!turf.area||!turf.polygonize||!turf.union||!turf.lineIntersect||!turf.booleanValid){
  say("Territory was not captured because the geometry library did not load. Check internet and try again; your GPS mission stats remain saved.");
  return;
 }
  let faces=[];
  try{
   const coords=route.map(p=>[p.lon,p.lat]);
   if(coords.length<4){say("Territory rejected: record at least 4 reliable GPS points.");return;}
   // Polygonize individual route segments so bow-ties and multiple enclosed faces are handled.
   const rawSegments=[];
   for(let i=0;i<coords.length-1;i++)if(coords[i][0]!==coords[i+1][0]||coords[i][1]!==coords[i+1][1])rawSegments.push([coords[i],coords[i+1]]);
   if(coords[coords.length-1][0]!==coords[0][0]||coords[coords.length-1][1]!==coords[0][1])rawSegments.push([coords[coords.length-1],coords[0]]);
   if(rawSegments.length<3){say("Territory rejected: route has too few distinct segments.");return;}
   // Node linework at crossings before polygonize; polygonize expects intersections to be explicit vertices.
   const cuts=rawSegments.map(seg=>[seg[0],seg[1]]);
   for(let i=0;i<rawSegments.length;i++)for(let j=i+1;j<rawSegments.length;j++){
    if(j===i+1||(i===0&&j===rawSegments.length-1))continue;
    const intersections=turf.lineIntersect(turf.lineString(rawSegments[i]),turf.lineString(rawSegments[j]));
    for(const f of intersections.features){const pt=f.geometry.coordinates;cuts[i].push(pt);cuts[j].push(pt);}
   }
   const segments=[];
   for(let i=0;i<cuts.length;i++){
    const a=rawSegments[i][0];
    const sorted=cuts[i].slice().sort((p,q)=>distanceBetween({lon:a[0],lat:a[1]},{lon:p[0],lat:p[1]})-distanceBetween({lon:a[0],lat:a[1]},{lon:q[0],lat:q[1]}));
    for(let j=0;j<sorted.length-1;j++)if(distanceBetween({lon:sorted[j][0],lat:sorted[j][1]},{lon:sorted[j+1][0],lat:sorted[j+1][1]})>0.01)segments.push([sorted[j],sorted[j+1]]);
   }
   const linework=turf.multiLineString(segments);
   const polygonized=turf.polygonize(linework);
   faces=(polygonized.features||[]).filter(f=>f&&f.geometry&&f.geometry.type==="Polygon"&&turf.area(f)>=MIN_TERRITORY_AREA_M2&&turf.booleanValid(f));
   // Fallback for an ordinary non-self-crossing route: directly validate its automatically closed ring.
   // This avoids rejecting a simple loop merely because polygonize returns no faces for that linework.
   if(!faces.length){
    const ring=coords.slice();
    if(ring.length && (ring[0][0]!==ring[ring.length-1][0]||ring[0][1]!==ring[ring.length-1][1]))ring.push(ring[0]);
    const distinct=new Set(ring.slice(0,-1).map(p=>p[0]+","+p[1]));
    if(distinct.size>=3){
     const direct=turf.polygon([ring]);
     if(turf.area(direct)>=MIN_TERRITORY_AREA_M2&&turf.booleanValid(direct))faces=[direct];
    }
   }
   if(!faces.length){say("Territory not created: the GPS route did not form a valid enclosed area. Record a loop with 
