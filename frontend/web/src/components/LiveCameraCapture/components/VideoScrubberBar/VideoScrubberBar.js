/**
 * Subcomponente de Controlo de Reprodução e Scrubber Temporal (VideoScrubberBar).
 *
 * Responsabilidade:
 * - Interface do reprodutor com relógio digital, barra de tempo interativa,
 *   controlos de reprodução, velocidades e configuração de loop A-B.
 */

export default {
  name: 'VideoScrubberBar',
  props: {
    videoDuration: { type: Number, default: 0 },
    videoCurrentTime: { type: Number, default: 0 },
    formattedVideoTime: { type: String, default: '00:00.0' },
    formattedDuration: { type: String, default: '00:00.0' },
    playbackDirection: { type: String, default: 'forward' },
    hasLoopRange: { type: Boolean, default: false },
    loopRangeLabel: { type: String, default: '' },
    isInfiniteLoopActive: { type: Boolean, default: false },
    isFullVideoScanRunning: { type: Boolean, default: false },
    isTimelineDragging: { type: Boolean, default: false },
    timelineHoverLabel: { type: String, default: '' },
    timelineHoverPercent: { type: Number, default: 0 },
    playheadPercent: { type: Number, default: 0 },
    hasTimelineRegion: { type: Boolean, default: false },
    loopPreviewRange: { type: Object, default: null },
    timelineRegionStyle: { type: Object, default: () => ({}) },
    timelineRangeStartPercent: { type: Number, default: 0 },
    timelineRangeEndPercent: { type: Number, default: 0 },
    pendingLoopPointA: { type: Number, default: null },
    pendingLoopPointLabel: { type: String, default: '' },
    timeTicks: { type: Array, default: () => [] },
    timelineTickStepLabel: { type: String, default: '1s' },
    loopPreviewLabel: { type: String, default: '' },
    isVideoPlaying: { type: Boolean, default: false },
    isReversePlaying: { type: Boolean, default: false },
    videoPlaybackRate: { type: Number, default: 1 },
    autoSlowdownEnabled: { type: Boolean, default: false },
    isAutoSlowedDown: { type: Boolean, default: false },
    loopAInput: { type: String, default: '' },
    loopBInput: { type: String, default: '' },
    loopRange: { type: Object, default: () => ({ start: 0, end: 0, enabled: false }) },
    rangeDuration: { type: Number, default: 0 },
    rangeRelativeCurrentTime: { type: Number, default: 0 },
    rangeProgressPercent: { type: Number, default: 0 },
  },
  data() {
    return {
      hoverTime: null,
      hoverPercent: 0,
      hoverLabel: '',
    };
  },
  computed: {
    effectiveDuration() {
      return this.videoDuration > 0 ? this.videoDuration : 100;
    },
    computedPlayheadPercent() {
      if (this.videoDuration > 0) {
        return Math.min(100, Math.max(0, (this.videoCurrentTime / this.videoDuration) * 100));
      }
      return 0;
    },
    computedPinAPercent() {
      if (this.videoDuration > 0 && this.loopRange?.start !== undefined) {
        return Math.min(100, Math.max(0, (this.loopRange.start / this.videoDuration) * 100));
      }
      return 0;
    },
    computedPinBPercent() {
      if (this.videoDuration > 0 && this.loopRange?.end !== undefined) {
        return Math.min(100, Math.max(0, (this.loopRange.end / this.videoDuration) * 100));
      }
      return 100;
    },
    computedLoopStyle() {
      const start = this.computedPinAPercent;
      const end = this.computedPinBPercent;
      return {
        left: `${start}%`,
        width: `${Math.max(0, end - start)}%`,
      };
    },
  },
  emits: [
    'seek',
    'toggle-play',
    'seek-relative',
    'trigger-file',
    'set-speed',
    'toggle-slowdown',
    'toggle-loop',
    'toggle-infinite-loop',
    'set-loop-from-current',
    'clear-loop',
    'step-range-frame',
  ],
  methods: {
    onSliderInput(e) {
      const val = Number(e.target.value);
      this.$emit('seek', val);
    },
    onSliderChange(e) {
      const val = Number(e.target.value);
      this.$emit('seek', val);
    },
    onTogglePlay() {
      this.$emit('toggle-play');
    },
    onSeekRelative(delta) {
      this.$emit('seek-relative', delta);
    },
    onStepRangeFrame(delta) {
      this.$emit('step-range-frame', delta);
    },
    onSetSpeed(rate) {
      this.$emit('set-speed', rate);
    },
    onToggleSlowdown() {
      this.$emit('toggle-slowdown');
    },
    onSetLoopFromCurrent(which) {
      this.$emit('set-loop-from-current', which);
    },
    onToggleLoop() {
      this.$emit('toggle-loop');
    },
    onToggleInfiniteLoop() {
      this.$emit('toggle-infinite-loop');
    },
    onClearLoop() {
      this.$emit('clear-loop');
    },
    onTriggerFile() {
      this.$emit('trigger-file');
    },
    handleTimelineMouseMove(e) {
      const track = this.$refs.timelineTrack;
      if (!track || !this.videoDuration) return;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.hoverPercent = pct * 100;
      this.hoverTime = pct * this.videoDuration;
      const m = Math.floor(this.hoverTime / 60);
      const s = (this.hoverTime % 60).toFixed(1);
      this.hoverLabel = `${String(m).padStart(2, '0')}:${String(s).padStart(4, '0')}`;
    },
    handleTimelineMouseLeave() {
      this.hoverLabel = '';
      this.hoverTime = null;
    },
  },
};
