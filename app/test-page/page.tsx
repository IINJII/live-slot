export default function TestPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Live Slot — Test Page</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; color: #18181b; }

          /* NAV */
          nav { background: #fff; border-bottom: 1px solid #e4e4e7; padding: 0 32px; display: flex; align-items: center; justify-content: space-between; height: 56px; }
          nav .logo { font-size: 18px; font-weight: 700; color: #18181b; }
          nav .links { display: flex; gap: 24px; font-size: 14px; color: #71717a; }
          nav .links a { text-decoration: none; color: inherit; }

          /* LEADERBOARD TOP */
          .leaderboard-top { display: flex; justify-content: center; padding: 16px 0; background: #fff; border-bottom: 1px solid #e4e4e7; }

          /* LAYOUT */
          .page { max-width: 1280px; margin: 0 auto; padding: 32px 24px; display: grid; grid-template-columns: 1fr 300px; gap: 32px; }

          /* MAIN CONTENT */
          .main { min-width: 0; }
          .hero { background: #fff; border-radius: 12px; padding: 32px; margin-bottom: 24px; border: 1px solid #e4e4e7; }
          .hero h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
          .hero p { color: #71717a; font-size: 15px; line-height: 1.6; }

          .article-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
          .article-card { background: #fff; border-radius: 10px; border: 1px solid #e4e4e7; overflow: hidden; }
          .article-img { height: 140px; background: linear-gradient(135deg, #e0e7ff, #ddd6fe); }
          .article-body { padding: 14px; }
          .article-body h3 { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
          .article-body p { font-size: 12px; color: #71717a; line-height: 1.5; }

          /* IN-FEED AD */
          .infeed-wrap { display: flex; justify-content: center; margin: 24px 0; }

          /* SIDEBAR */
          .sidebar { display: flex; flex-direction: column; gap: 20px; }
          .sidebar-widget { background: #fff; border-radius: 10px; border: 1px solid #e4e4e7; padding: 16px; }
          .sidebar-widget h4 { font-size: 13px; font-weight: 600; color: #71717a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
          .sidebar-widget ul { list-style: none; display: flex; flex-direction: column; gap: 8px; }
          .sidebar-widget li { font-size: 13px; color: #3f3f46; padding-bottom: 8px; border-bottom: 1px solid #f4f4f5; }

          /* AD SLOTS */
          .ad-slot {
            display: flex;
            align-items: center;
            justify-content: center;
            background: repeating-linear-gradient(
              45deg,
              #fafafa,
              #fafafa 8px,
              #f0f0f0 8px,
              #f0f0f0 16px
            );
            border: 1.5px dashed #d4d4d8;
            border-radius: 6px;
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
          }
          .ad-slot::after {
            content: attr(data-label);
            position: absolute;
            bottom: 6px;
            right: 8px;
            font-size: 10px;
            color: #a1a1aa;
            font-family: monospace;
            letter-spacing: 0.03em;
          }
          .ad-slot-inner {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
          }
          .ad-slot-inner span.tag {
            font-size: 10px;
            font-weight: 600;
            color: #a1a1aa;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .ad-slot-inner span.size {
            font-size: 13px;
            font-weight: 700;
            color: #71717a;
          }
          .ad-slot-inner span.name {
            font-size: 11px;
            color: #a1a1aa;
          }

          /* BILLBOARD */
          .billboard-wrap { display: flex; justify-content: center; padding: 24px; background: #fff; border-top: 1px solid #e4e4e7; border-bottom: 1px solid #e4e4e7; margin: 0 -24px; }

          /* FOOTER */
          footer { text-align: center; padding: 32px; font-size: 12px; color: #a1a1aa; border-top: 1px solid #e4e4e7; margin-top: 40px; background: #fff; }

          /* LABEL BADGE */
          .ad-badge {
            position: absolute;
            top: 6px;
            left: 8px;
            background: #fbbf24;
            color: #78350f;
            font-size: 9px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
        `}</style>
      </head>
      <body>

        {/* NAV */}
        <nav>
          <span className="logo">The Daily Read</span>
          <div className="links">
            <a href="#">News</a>
            <a href="#">Tech</a>
            <a href="#">Business</a>
            <a href="#">Sports</a>
            <a href="#">Opinion</a>
          </div>
        </nav>

        {/* LEADERBOARD 728×90 */}
        <div className="leaderboard-top">
          <div
            id="div-gpt-ad-leaderboard-top"
            className="ad-slot"
            data-ad-slot="leaderboard-top"
            data-label="728×90"
            style={{ width: 728, height: 90 }}
          >
            <span className="ad-badge">Ad</span>
            <div className="ad-slot-inner">
              <span className="tag">Advertisement</span>
              <span className="size">728 × 90</span>
              <span className="name">Leaderboard</span>
            </div>
          </div>
        </div>

        {/* PAGE BODY */}
        <div className="page">

          {/* MAIN */}
          <div className="main">
            <div className="hero">
              <h1>Breaking: Markets Hit Record Highs</h1>
              <p>Global markets surged to record highs today as investors reacted positively to better-than-expected earnings reports from major technology companies. Analysts say momentum could continue through the quarter.</p>
            </div>

            {/* IN-FEED MEDIUM RECTANGLE 300×250 */}
            <div className="infeed-wrap">
              <div
                id="div-gpt-ad-mrec-infeed"
                className="ad-slot"
                data-ad-slot="mrec-infeed"
                data-label="300×250"
                style={{ width: 300, height: 250 }}
              >
                <span className="ad-badge">Ad</span>
                <div className="ad-slot-inner">
                  <span className="tag">Advertisement</span>
                  <span className="size">300 × 250</span>
                  <span className="name">Medium Rectangle</span>
                </div>
              </div>
            </div>

            <div className="article-grid">
              {[
                ['Tech Giants Report Strong Q4', 'Revenue beats estimates across the board as cloud spending accelerates heading into the new year.'],
                ['Climate Summit Reaches Deal', 'World leaders agreed on a new framework for carbon reduction targets at the annual summit in Geneva.'],
                ['AI Regulation Bill Advances', 'A landmark bill aimed at regulating artificial intelligence passed its second reading in parliament.'],
                ['Sports: Finals Preview', 'The championship matchup is set after two stunning semifinal victories over the weekend.'],
              ].map(([title, body], i) => (
                <div key={i} className="article-card">
                  <div className="article-img" style={{ background: `linear-gradient(135deg, ${['#dbeafe,#e0e7ff','#dcfce7,#d1fae5','#fef9c3,#fef3c7','#fce7f3,#fdf2f8'][i]})` }} />
                  <div className="article-body">
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* LARGE RECTANGLE 336×280 */}
            <div className="infeed-wrap">
              <div
                id="div-gpt-ad-large-rect"
                className="ad-slot"
                data-ad-slot="large-rect"
                data-label="336×280"
                style={{ width: 336, height: 280 }}
              >
                <span className="ad-badge">Ad</span>
                <div className="ad-slot-inner">
                  <span className="tag">Advertisement</span>
                  <span className="size">336 × 280</span>
                  <span className="name">Large Rectangle</span>
                </div>
              </div>
            </div>
          </div>

          {/* SIDEBAR */}
          <div className="sidebar">

            {/* SIDEBAR MREC 300×250 */}
            <div
              id="div-gpt-ad-sidebar-mrec"
              className="ad-slot"
              data-ad-slot="sidebar-mrec"
              data-label="300×250"
              style={{ width: 300, height: 250 }}
            >
              <span className="ad-badge">Ad</span>
              <div className="ad-slot-inner">
                <span className="tag">Advertisement</span>
                <span className="size">300 × 250</span>
                <span className="name">Medium Rectangle</span>
              </div>
            </div>

            <div className="sidebar-widget">
              <h4>Trending</h4>
              <ul>
                {['Fed Rate Decision Looms', 'EV Sales Surge 40%', 'New Space Mission Launches', 'Startup Raises $200M', 'Olympic Bid Announced'].map((item, i) => (
                  <li key={i}>{i + 1}. {item}</li>
                ))}
              </ul>
            </div>

            {/* HALF PAGE 300×600 */}
            <div
              id="div-gpt-ad-halfpage"
              className="ad-slot"
              data-ad-slot="halfpage"
              data-label="300×600"
              style={{ width: 300, height: 600 }}
            >
              <span className="ad-badge">Ad</span>
              <div className="ad-slot-inner">
                <span className="tag">Advertisement</span>
                <span className="size">300 × 600</span>
                <span className="name">Half Page</span>
              </div>
            </div>

          </div>
        </div>

        {/* BILLBOARD 970×250 */}
        <div className="billboard-wrap">
          <div
            id="div-gpt-ad-billboard"
            className="ad-slot"
            data-ad-slot="billboard"
            data-label="970×250"
            style={{ width: 970, height: 250 }}
          >
            <span className="ad-badge">Ad</span>
            <div className="ad-slot-inner">
              <span className="tag">Advertisement</span>
              <span className="size">970 × 250</span>
              <span className="name">Billboard</span>
            </div>
          </div>
        </div>

        {/* MOBILE BANNER 320×50 (visible indicator) */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px', background: '#fafafa' }}>
          <div
            id="div-gpt-ad-mobile-banner"
            className="ad-slot"
            data-ad-slot="mobile-banner"
            data-label="320×50"
            style={{ width: 320, height: 50 }}
          >
            <span className="ad-badge">Ad</span>
            <div className="ad-slot-inner" style={{ flexDirection: 'row', gap: 8 }}>
              <span className="tag">Ad</span>
              <span className="size" style={{ fontSize: 12 }}>320 × 50 — Mobile Banner</span>
            </div>
          </div>
        </div>

        <footer>
          This is a test page for Live Slot ad slot detection. All content is fictional.
        </footer>

      </body>
    </html>
  );
}
