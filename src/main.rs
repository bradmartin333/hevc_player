use eframe::egui;
use egui::{Color32, ColorImage, TextureHandle, TextureOptions};
use std::env;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use serde_json::Value;

enum VideoCommand {
    Open(String),
    Play,
    Pause,
    Stop,
}

struct FrameData {
    image: ColorImage,
    metadata: String,
    sei_data: String,
}

fn main() -> Result<(), eframe::Error> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1280.0, 720.0]),
        ..Default::default()
    };
    let args: Vec<String> = env::args().collect();
    let initial_path = args.get(1).cloned();

    eframe::run_native(
        "HEVC Player",
        options,
        Box::new(move |_cc| Box::new(HevcPlayerApp::new(initial_path))),
    )
}

struct HevcPlayerApp {
    video_texture: Option<TextureHandle>,
    metadata: String,
    sei_data: String,
    playback_state: PlaybackState,
    video_thread_tx: Sender<VideoCommand>,
    frame_rx: Receiver<FrameData>,
    show_open_button: bool,
}

#[derive(PartialEq)]
enum PlaybackState {
    Playing,
    Paused,
    Stopped,
}

impl HevcPlayerApp {
    fn new(initial_path: Option<String>) -> Self {
        let (video_thread_tx, video_thread_rx) = channel();
        let (frame_tx, frame_rx) = channel();

        thread::spawn(move || {
            video_thread(video_thread_rx, frame_tx);
        });

        let show_open_button = initial_path.is_none();

        if let Some(path) = initial_path {
            video_thread_tx.send(VideoCommand::Open(path)).unwrap();
        }

        Self {
            video_texture: None,
            metadata: "No file loaded".to_string(),
            sei_data: "No SEI data".to_string(),
            playback_state: if show_open_button {
                PlaybackState::Stopped
            } else {
                PlaybackState::Playing
            },
            video_thread_tx,
            frame_rx,
            show_open_button,
        }
    }
}

impl eframe::App for HevcPlayerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let Ok(frame_data) = self.frame_rx.try_recv() {
            self.metadata = frame_data.metadata;
            self.sei_data = frame_data.sei_data;
            let texture = ctx.load_texture(
                "video_frame",
                frame_data.image,
                TextureOptions::LINEAR,
            );
            self.video_texture = Some(texture);
        }

        egui::CentralPanel::default().show(ctx, |ui| {
            if let Some(texture) = &self.video_texture {
                let image = egui::Image::new(texture)
                    .max_size(ui.available_size());
                ui.add(image);
            } else {
                ui.colored_label(Color32::BLACK, "No video to display");
            }
        });

        egui::SidePanel::right("metadata_panel")
            .resizable(true)
            .show(ctx, |ui| {
                ui.heading("Metadata");
                ui.separator();
                ui.label(&self.metadata);

                ui.add_space(20.0);

                ui.heading("SEI NAL User Data (JSON)");
                ui.separator();
                egui::ScrollArea::vertical().show(ui, |ui| {
                    ui.label(&self.sei_data);
                });
            });

        egui::TopBottomPanel::bottom("playback_controls").show(ctx, |ui| {
            ui.horizontal(|ui| {
                if self.show_open_button {
                    if ui.button("Open").clicked() {
                        if let Some(path) = rfd::FileDialog::new().pick_file() {
                            self.video_thread_tx
                                .send(VideoCommand::Open(path.display().to_string()))
                                .unwrap();
                            self.playback_state = PlaybackState::Playing;
                        }
                    }
                }

                if self.playback_state != PlaybackState::Playing {
                    if ui.button("Play").clicked() {
                        self.playback_state = PlaybackState::Playing;
                        self.video_thread_tx.send(VideoCommand::Play).unwrap();
                    }
                } else {
                    if ui.button("Pause").clicked() {
                        self.playback_state = PlaybackState::Paused;
                        self.video_thread_tx.send(VideoCommand::Pause).unwrap();
                    }
                }

                if ui.button("Stop").clicked() {
                    self.playback_state = PlaybackState::Stopped;
                    self.video_thread_tx.send(VideoCommand::Stop).unwrap();
                    self.video_texture = None;
                    self.metadata = "No file loaded".to_string();
                    self.sei_data = "No SEI data".to_string();
                }
            });
        });
        ctx.request_repaint();
    }
}

fn video_thread(rx: Receiver<VideoCommand>, tx: Sender<FrameData>) {
    ffmpeg_next::init().unwrap();

    let mut ictx: Option<ffmpeg_next::format::context::Input> = None;
    let mut decoder: Option<ffmpeg_next::codec::decoder::video::Video> = None;
    let mut scaler: Option<ffmpeg_next::software::scaling::context::Context> = None;
    let mut stream_index: Option<usize> = None;
    let mut paused = true;
    let mut metadata = "No file loaded".to_string();

    loop {
        if let Ok(cmd) = rx.try_recv() {
            match cmd {
                VideoCommand::Open(path) => {
                    ictx = Some(ffmpeg_next::format::input(&path).unwrap());
                    if let Some(ref ictx) = ictx {
                        metadata = format!("{:#?}", ictx.metadata());
                    }
                    let input = ictx.as_mut().unwrap().streams().best(ffmpeg_next::media::Type::Video).unwrap();
                    stream_index = Some(input.index());

                    let context = ffmpeg_next::codec::context::Context::from_parameters(input.parameters()).unwrap();
                    let mut new_decoder = context.decoder().video().unwrap();
                    new_decoder.set_threading(ffmpeg_next::threading::Config {
                        kind: ffmpeg_next::threading::Type::Frame,
                        count: 0,
                        safe: false,
                    });
                    decoder = Some(new_decoder);

                    let new_scaler = ffmpeg_next::software::scaling::context::Context::get(
                        decoder.as_ref().unwrap().format(),
                        decoder.as_ref().unwrap().width(),
                        decoder.as_ref().unwrap().height(),
                        ffmpeg_next::format::Pixel::RGBA,
                        decoder.as_ref().unwrap().width(),
                        decoder.as_ref().unwrap().height(),
                        ffmpeg_next::software::scaling::flag::Flags::BILINEAR,
                    )
                    .unwrap();
                    scaler = Some(new_scaler);
                    paused = false;
                }
                VideoCommand::Play => paused = false,
                VideoCommand::Pause => paused = true,
                VideoCommand::Stop => {
                    ictx = None;
                    decoder = None;
                    scaler = None;
                    stream_index = None;
                    metadata = "No file loaded".to_string();
                }
            }
        }

        if !paused {
            if let (Some(ictx), Some(decoder), Some(scaler), Some(stream_index)) =
                (&mut ictx, &mut decoder, &mut scaler, stream_index)
            {
                for (stream, packet) in ictx.packets() {
                    if stream.index() == stream_index {
                        let mut sei_data_vec = Vec::new();
                        for side_data in packet.side_data() {
                            println!("Found side data of kind: {:?} with length: {}", side_data.kind(), side_data.data().len());
                            // Attempt to parse any side data as an SEI message
                            let mut current_sei_payload = side_data.data();
                            while let Some((payload_type, _payload_size, payload_data, remaining)) = parse_sei_message(current_sei_payload) {
                                if payload_type == 0x05 { // User data unregistered
                                    if payload_data.len() >= 16 {
                                        // First 16 bytes are UUID, rest is user data
                                        let user_data_bytes = &payload_data[16..];
                                        if let Ok(json) = serde_json::from_slice::<Value>(user_data_bytes) {
                                            sei_data_vec.push(json);
                                        }
                                    }
                                }
                                current_sei_payload = remaining;
                                if current_sei_payload.is_empty() {
                                    break;
                                }
                            }
                        }

                        decoder.send_packet(&packet).unwrap();
                        let mut decoded = ffmpeg_next::frame::Video::empty();
                        while decoder.receive_frame(&mut decoded).is_ok() {
                            let mut rgba_frame = ffmpeg_next::frame::Video::empty();
                            scaler.run(&decoded, &mut rgba_frame).unwrap();

                            let image = ColorImage::from_rgba_unmultiplied(
                                [rgba_frame.width() as usize, rgba_frame.height() as usize],
                                rgba_frame.data(0),
                            );

                            let sei_data = if sei_data_vec.is_empty() {
                                "No SEI data".to_string()
                            } else {
                                serde_json::to_string_pretty(&sei_data_vec).unwrap_or_else(|_| "Failed to format SEI data".to_string())
                            };

                            tx.send(FrameData {
                                image,
                                metadata: metadata.clone(),
                                sei_data,
                            })
                            .unwrap();
                        }
                    }
                }
            }
        }
    }
}

// Helper function to parse variable-length payload type/size
fn parse_vlc_value(data: &[u8], offset: &mut usize) -> Option<u32> {
    let mut value = 0u32;
    loop {
        if *offset >= data.len() {
            return None; // Not enough data
        }
        let byte = data[*offset];
        *offset += 1;
        value += byte as u32;
        if byte != 0xFF {
            break;
        }
    }
    Some(value)
}

// Function to parse a single SEI message
fn parse_sei_message(data: &[u8]) -> Option<(u32, u32, &[u8], &[u8])> {
    let mut offset = 0;

    let payload_type = parse_vlc_value(data, &mut offset)?;
    let payload_size = parse_vlc_value(data, &mut offset)?;

    if offset + payload_size as usize > data.len() {
        return None; // Not enough data for payload
    }

    let payload_data = &data[offset..offset + payload_size as usize];
    let remaining_data = &data[offset + payload_size as usize..];

    Some((payload_type, payload_size, payload_data, remaining_data))
}