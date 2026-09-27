export const teamCampusMap = Object.freeze({
  campusName: '山河大学 · 校园数字孪生',
  version: 'shared-repo-main-7a3e0d7',
  sourceCommit: '7a3e0d7a3fdd2981a666ea0b7cd656041f3983c0',
  coordinateSystem: Object.freeze({
    svgScaleMetersPerPixel: 2.4,
    svgOrigin: [340, 516],
    groundY: 3,
    axes: 'Blender X=东 / Y=北 / Z=上；Three.js [x,y,z]=[Blender x, Blender z, -Blender y]',
  }),
  defaultScene: '3d',
  scenes: {
    '2d': {
      imageUrl: '/assets/shanhe-campus-plan.svg',
      imageWidth: 680,
      imageHeight: 595,
      sourceUrl: 'https://github.com/zhchunyu/Chun-Yu/blob/main/01-%E4%BA%A7%E5%93%81%E8%AE%BE%E8%AE%A1/%E5%B1%B1%E6%B2%B3%E5%A4%A7%E5%AD%A6_%E6%80%BB%E5%B9%B3%E9%9D%A2%E6%A0%BC%E5%B1%80%E5%9B%BE.svg',
      sourceLabel: '共享仓库 · 山河大学总平面格局图',
    },
    '3d': {
      modelUrl: '/assets/campus.glb',
      modelSource: '共享仓库 main · 山河大学校园 GLB',
      modelSourceUrl: 'https://github.com/zhchunyu/Chun-Yu/tree/main/02-%E4%B8%89%E7%BB%B4%E8%B5%84%E4%BA%A7/site',
      modelSize: '5.7 MB',
      modelBytes: 5972880,
      loadingMode: 'on-demand',
    },
  },
})
