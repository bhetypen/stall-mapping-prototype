import { useEffect, useRef, useState } from "react";
import { GoogleMap, LoadScript, Autocomplete } from "@react-google-maps/api";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Stage, Layer, Rect, Transformer, Text, Line } from "react-konva";
import { v4 as uuidv4 } from "uuid";

import {
    Box,
    Button,
    FormControlLabel,
    Switch,
    TextField,
    Typography,
    Paper,
} from "@mui/material";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ImageIcon from "@mui/icons-material/Image";
import CodeIcon from "@mui/icons-material/Code";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const MAP_W = 800;
const MAP_H = 600;

// Web Mercator meters-per-pixel at latitude + zoom
const metersPerPixel = (lat, zoom) => {
    const R = 6378137;
    return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * R) / (256 * Math.pow(2, zoom));
};

export default function PlannerDualFull() {
    // Engine toggle
    const [engine, setEngine] = useState("google"); // "google" | "maplibre"

    // View state
    const [center, setCenter] = useState({ lat: 48.30694, lng: 14.28583 });
    const [zoom, setZoom] = useState(17);

    // Saved zoom state
    const [zoomConfirmed, setZoomConfirmed] = useState(false);
    const [finalLat, setFinalLat] = useState(null);
    const [finalLng, setFinalLng] = useState(null);
    const [finalZoom, setFinalZoom] = useState(null);

    // Previous view (Go Back)
    const [prevCenter, setPrevCenter] = useState(null);
    const [prevZoom, setPrevZoom] = useState(null);

    // Stalls & editing
    const [stalls, setStalls] = useState(() => {
        const saved = localStorage.getItem("stalls_dual_full");
        return saved ? JSON.parse(saved) : [];
    });
    const persist = (arr) => localStorage.setItem("stalls_dual_full", JSON.stringify(arr));

    const [stallWidth, setStallWidth] = useState(2);
    const [stallHeight, setStallHeight] = useState(3);
    const [latestStallId, setLatestStallId] = useState(null);
    const [lastEditedStallId, setLastEditedStallId] = useState(null);
    const [newStallRotation, setNewStallRotation] = useState(45);

    const [selectedStall, setSelectedStall] = useState(null);
    const transformerRefs = useRef({});

    // Placement click mode
    const [placementMode, setPlacementMode] = useState(false);

    // UI bits
    const [selectedDate, setSelectedDate] = useState("");
    const [scaleBarAngle, setScaleBarAngle] = useState(48);

    // Refs
    const stageRef = useRef(null);
    const autocompleteRef = useRef(null);

    const gmapRef = useRef(null);
    const libreMapRef = useRef(null);
    const libreContainerRef = useRef(null);

    // OSM search for MapLibre
    const [osmQuery, setOsmQuery] = useState("");

    const metersToPixels = (m) => m / metersPerPixel(center.lat, zoom);

    // ----- MapLibre init -----
    useEffect(() => {
        if (!libreContainerRef.current || libreMapRef.current) return;
        const map = new maplibregl.Map({
            container: libreContainerRef.current,
            style: "https://demotiles.maplibre.org/style.json",
            center: [center.lng, center.lat],
            zoom,
        });
        libreMapRef.current = map;

        const sync = () => {
            const c = map.getCenter();
            setCenter({ lat: c.lat, lng: c.lng });
            setZoom(map.getZoom());
        };
        map.on("move", sync);
        map.on("zoom", sync);

        return () => {
            map.remove();
            libreMapRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ----- Engine toggle -----
    const toggleEngine = (checked) => {
        const next = checked ? "maplibre" : "google";
        setEngine(next);
        // Sync current view into target engine
        if (next === "google" && gmapRef.current) {
            gmapRef.current.setCenter(center);
            gmapRef.current.setZoom(zoom);
        } else if (next === "maplibre" && libreMapRef.current) {
            libreMapRef.current.setCenter([center.lng, center.lat]);
            libreMapRef.current.setZoom(zoom);
        }
    };

    // ----- Google events -----
    const onGMapLoad = (map) => (gmapRef.current = map);
    const onGCenterChanged = () => {
        if (!gmapRef.current) return;
        const c = gmapRef.current.getCenter();
        setCenter({ lat: c.lat(), lng: c.lng() });
    };
    const onGZoomChanged = () => {
        if (!gmapRef.current) return;
        setZoom(gmapRef.current.getZoom());
    };

    // ----- Search -----
    const onPlaceChanged = () => {
        const ac = autocompleteRef.current;
        if (!ac || !gmapRef.current) return;
        const p = ac.getPlace();
        if (p && p.geometry) {
            const lat = p.geometry.location.lat();
            const lng = p.geometry.location.lng();
            setPrevCenter(center);
            setPrevZoom(zoom);
            gmapRef.current.panTo({ lat, lng });
            gmapRef.current.setZoom(17);
        }
    };

    const searchOSM = async () => {
        if (!osmQuery || !libreMapRef.current) return;
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(osmQuery)}`
        );
        const data = await res.json();
        if (!data?.length) return alert("No results");
        const lat = Number(data[0].lat);
        const lng = Number(data[0].lon);
        setPrevCenter(center);
        setPrevZoom(zoom);
        libreMapRef.current.setCenter([lng, lat]);
        libreMapRef.current.setZoom(17);
    };

    // ----- Overlay click -----
    const handleOverlayClick = (e) => {
        // If placement mode and zoom saved → add a stall at click
        if (zoomConfirmed && placementMode) {
            const stage = e.target.getStage();
            const { x, y } = stage.getPointerPosition();
            const wPx = metersToPixels(Number(stallWidth));
            const hPx = metersToPixels(Number(stallHeight));
            const stall = {
                id: uuidv4(),
                x: x - wPx / 2,
                y: y - hPx / 2,
                width: wPx,
                height: hPx,
                rotation: Number(newStallRotation) || 0,
            };
            setStalls((prev) => {
                const upd = [...prev, stall];
                persist(upd);
                setLatestStallId(stall.id);
                setLastEditedStallId(stall.id);
                return upd;
            });
            return;
        }

        // Before zoom is saved: click to recenter active engine
        if (!zoomConfirmed) {
            setPrevCenter(center);
            setPrevZoom(zoom);

            if (engine === "google" && gmapRef.current) {
                // Convert Stage px -> LatLng using Google projection
                const stage = e.target.getStage();
                const { x, y } = stage.getPointerPosition();
                const proj = gmapRef.current.getProjection();
                const bounds = gmapRef.current.getBounds();
                if (!proj || !bounds) return;

                const topRight = proj.fromLatLngToPoint(bounds.getNorthEast());
                const bottomLeft = proj.fromLatLngToPoint(bounds.getSouthWest());
                const worldPoint = new google.maps.Point(
                    bottomLeft.x + (x / MAP_W) * (topRight.x - bottomLeft.x),
                    topRight.y + (y / MAP_H) * (bottomLeft.y - topRight.y)
                );
                const latLng = proj.fromPointToLatLng(worldPoint);
                gmapRef.current.panTo(latLng);
            }

            if (engine === "maplibre" && libreMapRef.current) {
                const stage = e.target.getStage();
                const { x, y } = stage.getPointerPosition();
                const ll = libreMapRef.current.unproject({ x, y });
                libreMapRef.current.setCenter([ll.lng, ll.lat]);
            }
        } else {
            setSelectedStall(null);
        }
    };

    // ----- Zoom controls -----
    const zoomIn = () => {
        setPrevCenter(center); setPrevZoom(zoom);
        if (engine === "google" && gmapRef.current) gmapRef.current.setZoom(Math.min(21, zoom + 1));
        if (engine === "maplibre" && libreMapRef.current) libreMapRef.current.zoomIn();
    };
    const zoomOut = () => {
        setPrevCenter(center); setPrevZoom(zoom);
        if (engine === "google" && gmapRef.current) gmapRef.current.setZoom(Math.max(10, zoom - 1));
        if (engine === "maplibre" && libreMapRef.current) libreMapRef.current.zoomOut();
    };
    const goBack = () => {
        if (!prevCenter) return;
        setZoomConfirmed(false);
        setStalls([]);
        if (engine === "google" && gmapRef.current) {
            gmapRef.current.setCenter(prevCenter);
            gmapRef.current.setZoom(prevZoom ?? zoom);
        }
        if (engine === "maplibre" && libreMapRef.current) {
            libreMapRef.current.setCenter([prevCenter.lng, prevCenter.lat]);
            libreMapRef.current.setZoom(prevZoom ?? zoom);
        }
    };
    const saveFinalZoom = () => {
        setFinalLat(center.lat);
        setFinalLng(center.lng);
        setFinalZoom(zoom);
        setZoomConfirmed(true);
    };

    // ----- Stalls: select/drag/rotate/delete -----
    const selectStall = (id) => {
        setSelectedStall(id);
        setTimeout(() => {
            const transformer = transformerRefs.current[id];
            if (!transformer) return;
            const node = transformer.getStage().findOne(`#stall-${id}`);
            if (node) {
                transformer.nodes([node]);
                transformer.getLayer().batchDraw();
            }
        });
    };
    const dragStall = (id, e) => {
        const { x, y } = e.target.position();
        setStalls((prev) => {
            const upd = prev.map((s) => (s.id === id ? { ...s, x, y } : s));
            persist(upd);
            return upd;
        });
        setLastEditedStallId(id);
    };
    const removeStall = (id, e) => {
        e.evt.preventDefault();
        setStalls((prev) => {
            const upd = prev.filter((s) => s.id !== id);
            persist(upd);
            return upd;
        });
        if (selectedStall === id) setSelectedStall(null);
    };
    const handleRotateStall = (id, e) => {
        const rot = e.target.rotation();
        const upd = stalls.map((s) => (s.id === id ? { ...s, rotation: rot } : s));
        setStalls(upd);
        persist(upd);
    };
    const handleRotation = (angle) => {
        let a = Number(angle);
        if (Number.isNaN(a)) a = 0;
        a = Math.max(0, Math.min(360, a));
        if (selectedStall) {
            setStalls((prev) => {
                const upd = prev.map((s) => (s.id === selectedStall ? { ...s, rotation: a } : s));
                persist(upd);
                return upd;
            });
        }
        setNewStallRotation(a);
    };

    // ----- Semi-automatic Add Next -----
    const addStallNext = () => {
        if (!zoomConfirmed) return alert("Confirm the zoom level first.");
        setStalls((prev) => {
            let ref = null;
            if (lastEditedStallId) ref = prev.find((s) => s.id === lastEditedStallId);
            if (!ref && prev.length) ref = prev[prev.length - 1];
            if (!ref) ref = { x: MAP_W / 2, y: MAP_H / 2, rotation: 45 };

            const wPx = metersToPixels(Number(stallWidth));
            const hPx = metersToPixels(Number(stallHeight));
            const gapPx = metersToPixels(0.5);

            const a = (Number(newStallRotation) * Math.PI) / 180;
            const ox = (wPx + gapPx) * Math.cos(a);
            const oy = (wPx + gapPx) * Math.sin(a);

            const stall = {
                id: uuidv4(),
                x: ref.x + ox,
                y: ref.y + oy,
                width: wPx,
                height: hPx,
                rotation: Number(newStallRotation),
            };
            const upd = [...prev, stall];
            persist(upd);
            setLatestStallId(stall.id);
            setLastEditedStallId(stall.id);
            return upd;
        });
    };

    // ----- Scale bar -----
    const calculateScale = () => {
        const scaleLengthMeters = 50;
        const scaleLengthPixels = metersToPixels(scaleLengthMeters);
        return { scaleLengthMeters, scaleLengthPixels };
    };

    // ----- Reset/Export -----
    const resetAll = () => {
        if (!confirm("Reset everything?")) return;
        localStorage.clear();
        location.reload();
    };
    const exportImage = () => {
        const stage = stageRef.current;
        if (!stage) return;
        const url = stage.toDataURL({ pixelRatio: 2, mimeType: "image/jpeg" });
        const a = document.createElement("a");
        a.href = url;
        a.download = "market_map.jpeg";
        a.click();
    };
    const exportHTML = () => {
        if (!selectedDate) return alert("Please select a date.");
        if (!finalLat || !finalZoom) return alert("Please save the zoom level first.");
        const data = stalls.map((s) => ({
            id: s.id,
            x_position: (s.x / MAP_W) * 100,
            y_position: (s.y / MAP_H) * 100,
            width: (s.width / MAP_W) * 100,
            height: (s.height / MAP_H) * 100,
            rotation: s.rotation,
            is_available: true,
        }));
        const html = `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Interactive Market Map</title>
<style>body{font-family:Arial;text-align:center}.map{position:relative;display:inline-block;width:${MAP_W}px;height:${MAP_H}px;background:#eee;border:1px solid #ccc}</style></head>
<body>
<h2>Interactive Market Map (${selectedDate})</h2>
<div>Center: ${finalLat.toFixed(6)}, ${finalLng.toFixed(6)} | Zoom: ${finalZoom.toFixed(2)}</div>
<div class="map" id="map"></div>
<script>
const W=${MAP_W}, H=${MAP_H};
const stalls=${JSON.stringify(data)};
const el=document.getElementById('map');
stalls.forEach(s=>{
  const d=document.createElement('div');
  d.style.position='absolute';
  d.style.left=(s.x_position*W/100)+'px';
  d.style.top=(s.y_position*H/100)+'px';
  d.style.width=(s.width*W/100)+'px';
  d.style.height=(s.height*H/100)+'px';
  d.style.background='rgba(255,0,0,0.6)';
  d.style.transformOrigin='top left';
  d.style.transform='rotate('+s.rotation+'deg)';
  el.appendChild(d);
});
</script>
</body></html>`;
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `market_map_${selectedDate}.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY} libraries={["places"]}>
            <div className="flex flex-col items-center justify-center p-6 bg-gray-100 min-h-screen" style={{ textAlign: "center" }}>
                <Typography variant="h5" className="mb-2">
                    Market Planner — Toggle Google 2D ↔ MapLibre GL (Konva overlay)
                </Typography>

                {/* Engine toggle */}
                <FormControlLabel
                    control={<Switch checked={engine === "maplibre"} onChange={(e) => toggleEngine(e.target.checked)} />}
                    label={engine === "maplibre" ? "MapLibre GL" : "Google Maps"}
                    sx={{ mb: 1 }}
                />

                {/* Date */}
                <TextField
                    label="Select Market Date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ mb: 2 }}
                />

                {/* Search (differs per engine) */}
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
                    {engine === "google" ? (
                        <Autocomplete onLoad={(ac) => (autocompleteRef.current = ac)} onPlaceChanged={onPlaceChanged}>
                            <TextField className="w-96" label="Search (Google Places)" variant="outlined" size="small" />
                        </Autocomplete>
                    ) : (
                        <>
                            <TextField
                                className="w-96"
                                label="Search (OpenStreetMap)"
                                variant="outlined"
                                size="small"
                                value={osmQuery}
                                onChange={(e) => setOsmQuery(e.target.value)}
                            />
                            <Button variant="contained" onClick={searchOSM}>Search</Button>
                        </>
                    )}
                </Box>

                {/* Controls */}
                <Box className="flex flex-wrap gap-2 justify-center mt-2">
                    <Button variant="contained" startIcon={<ZoomInIcon />} onClick={zoomIn}
                            sx={{ bgcolor: "#7EA63D", color: "#fff", "&:hover": { bgcolor: "#6C9330" } }}>
                        Zoom In
                    </Button>
                    <Button variant="contained" startIcon={<ZoomOutIcon />} onClick={zoomOut}
                            sx={{ bgcolor: "#7EA63D", color: "#fff", "&:hover": { bgcolor: "#6C9330" } }}>
                        Zoom Out
                    </Button>
                    <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={goBack}
                            sx={{ color: "#7EA63D", borderColor: "#7EA63D", "&:hover": { bgcolor: "#F5F5F5" } }}>
                        Go Back
                    </Button>
                    <Button variant="contained" startIcon={<SaveIcon />} onClick={saveFinalZoom} disabled={zoomConfirmed}
                            sx={{ bgcolor: zoomConfirmed ? "#ddd" : "#0056b3", color: zoomConfirmed ? "#777" : "#fff", "&:hover": { bgcolor: "#004494" } }}>
                        Save Zoom
                    </Button>
                </Box>

                {/* Placement toggle */}
                <FormControlLabel
                    sx={{ mt: 1 }}
                    control={<Switch checked={placementMode} onChange={(e) => setPlacementMode(e.target.checked)} />}
                    label="Placement mode (click to add)"
                />

                {/* Rotation + scale bar */}
                <Box className="flex items-center m-4 gap-4">
                    <Typography variant="subtitle1">Set Scale Bar Angle:</Typography>
                    <TextField type="number" value={scaleBarAngle} onChange={(e) => setScaleBarAngle(parseFloat(e.target.value))} size="small" className="w-24" />
                </Box>

                <Box className="inline-block bg-white/70 p-4 rounded-lg shadow mt-2 max-w-md mb-4">
                    <Typography variant="h6" className="mb-3">Rotate Stall</Typography>
                    <Box className="flex flex-nowrap gap-2 justify-center">
                        {[0, 45, 90, 135, 180, 225].map((a) => (
                            <Button key={a} variant="contained" onClick={() => handleRotation(a)}
                                    sx={{ bgcolor: "#7EA63D", color: "#fff", "&:hover": { bgcolor: "#6C9330" } }}>
                                {a}°
                            </Button>
                        ))}
                    </Box>
                    <Box className="mt-3 flex justify-center items-center gap-2">
                        <Typography variant="subtitle1">Custom Angle:</Typography>
                        <TextField type="number" value={newStallRotation} onChange={(e) => handleRotation(parseFloat(e.target.value))} size="small" className="w-24" />
                    </Box>
                </Box>

                {/* Add Stalls */}
                {zoomConfirmed && (
                    <Box className="bg-white/50 p-4 rounded-lg shadow-md max-w-md mb-4">
                        <Typography variant="h6" className="mb-2">Add Stalls</Typography>
                        <Box className="flex gap-2">
                            <TextField label="Width (meters)" type="number" value={stallWidth} onChange={(e) => setStallWidth(e.target.value)} size="small" className="w-full" />
                            <TextField label="Height (meters)" type="number" value={stallHeight} onChange={(e) => setStallHeight(e.target.value)} size="small" className="w-full" />
                        </Box>
                        <Typography variant="body2" className="text-gray-500 mt-2">
                            Use “Add Next” to place a stall beside the last one, or enable “Placement mode” and click the map.
                        </Typography>
                        <Button variant="contained" fullWidth onClick={addStallNext}
                                sx={{ bgcolor: "#7EA63D", color: "#fff", "&:hover": { bgcolor: "#6C9330" }, mt: 1.5 }}>
                            Add Next
                        </Button>
                    </Box>
                )}

                {/* Map + Konva overlay */}
                <Paper elevation={3} className="p-4 bg-white/80 rounded-lg shadow-md">
                    <Typography variant="h6" className="text-gray-700 font-medium text-center mb-2">
                        Map ({engine === "google" ? "Google" : "MapLibre"}) • Zoom: {zoom.toFixed(2)}
                    </Typography>

                    <div style={{ position: "relative", width: MAP_W, height: MAP_H }}>
                        {/* Google map underlay */}
                        <div style={{ position: "absolute", inset: 0, display: engine === "google" ? "block" : "none" }}>
                            <GoogleMap
                                mapContainerStyle={{ width: "100%", height: "100%" }}
                                center={center}
                                zoom={zoom}
                                onLoad={onGMapLoad}
                                onCenterChanged={onGCenterChanged}
                                onZoomChanged={onGZoomChanged}
                                options={{ gestureHandling: "greedy", clickableIcons: false }}
                            />
                        </div>

                        {/* MapLibre underlay */}
                        <div
                            ref={libreContainerRef}
                            style={{ position: "absolute", inset: 0, display: engine === "maplibre" ? "block" : "none" }}
                        />

                        {/* Konva overlay */}
                        <Stage
                            ref={stageRef}
                            width={MAP_W}
                            height={MAP_H}
                            onClick={handleOverlayClick}
                            style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
                        >
                            <Layer>
                                {/* Scale bar */}
                                {(() => {
                                    const { scaleLengthMeters, scaleLengthPixels } = (function () {
                                        const m = 50;
                                        return { scaleLengthMeters: m, scaleLengthPixels: metersToPixels(m) };
                                    })();
                                    const cx = MAP_W / 2;
                                    const cy = MAP_H / 2;
                                    const ang = (scaleBarAngle * Math.PI) / 180;
                                    const halfX = (scaleLengthPixels / 2) * Math.cos(ang);
                                    const halfY = (scaleLengthPixels / 2) * Math.sin(ang);
                                    const sx = cx - halfX;
                                    const sy = cy - halfY;
                                    const ex = cx + halfX;
                                    const ey = cy + halfY;

                                    const intervalMeters = 10;
                                    const intervalPx = metersToPixels(intervalMeters);
                                    const marks = [];
                                    for (let i = 1; i < scaleLengthMeters / intervalMeters; i++) {
                                        const d = intervalPx * i;
                                        const mx = sx + d * Math.cos(ang);
                                        const my = sy + d * Math.sin(ang);
                                        const sz = 5;
                                        const perp = ang + Math.PI / 2;
                                        marks.push(
                                            <Line
                                                key={`mark-${i}`}
                                                points={[
                                                    mx - sz * Math.cos(perp),
                                                    my - sz * Math.sin(perp),
                                                    mx + sz * Math.cos(perp),
                                                    my + sz * Math.sin(perp),
                                                ]}
                                                stroke="black"
                                                strokeWidth={2}
                                            />
                                        );
                                    }
                                    const textOffset = metersToPixels(5);
                                    const tx = ex + textOffset * Math.cos(ang);
                                    const ty = ey + textOffset * Math.sin(ang);
                                    return (
                                        <>
                                            <Line points={[sx, sy, ex, ey]} stroke="black" strokeWidth={2} opacity={0.3} />
                                            {marks}
                                            <Text x={tx} y={ty} text={`${scaleLengthMeters}m`} fontSize={14} fill="black" rotation={scaleBarAngle} />
                                        </>
                                    );
                                })()}

                                {/* Stalls */}
                                {stalls.map((s) => (
                                    <Rect
                                        key={s.id}
                                        id={`stall-${s.id}`}
                                        x={s.x}
                                        y={s.y}
                                        width={s.width}
                                        height={s.height}
                                        fill={s.id === latestStallId ? "green" : "red"}
                                        draggable
                                        rotation={s.rotation}
                                        onClick={(e) => {
                                            e.cancelBubble = true;
                                            selectStall(s.id);
                                        }}
                                        stroke={s.id === selectedStall ? "blue" : "transparent"}
                                        strokeWidth={s.id === selectedStall ? 3 : 0}
                                        onDragEnd={(e) => dragStall(s.id, e)}
                                        onTransformEnd={(e) => handleRotateStall(s.id, e)}
                                        onContextMenu={(e) => removeStall(s.id, e)}
                                    />
                                ))}

                                {selectedStall && (
                                    <Transformer
                                        ref={(node) => {
                                            if (node) transformerRefs.current[selectedStall] = node;
                                        }}
                                    />
                                )}
                            </Layer>
                        </Stage>
                    </div>
                </Paper>

                {/* Bottom actions */}
                <Box className="flex flex-wrap gap-3 justify-center mt-5">
                    <Button variant="contained" startIcon={<RestartAltIcon />} onClick={resetAll}
                            sx={{ bgcolor: "red", color: "white", "&:hover": { bgcolor: "#c62828" } }}>
                        Reset All (Clear & Refresh)
                    </Button>
                    <Button variant="contained" startIcon={<ImageIcon />} onClick={exportImage}
                            sx={{ bgcolor: "blue", color: "white", "&:hover": { bgcolor: "#1E3A8A" } }}>
                        Export as JPEG
                    </Button>
                    <Button variant="contained" startIcon={<CodeIcon />} onClick={exportHTML}
                            sx={{ bgcolor: "green", color: "white", "&:hover": { bgcolor: "#2E7D32" } }}>
                        Export as HTML
                    </Button>
                </Box>
            </div>
        </LoadScript>
    );
}
